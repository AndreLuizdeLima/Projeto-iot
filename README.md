# Aqua · Projeto IoT

MVP para monitorar uma caixa d’água com um sensor e uma bomba. O dispositivo determina os estados e decide se aceita encher. React exibe os dados e solicita enchimento; NestJS integra o Mosquitto, persiste as comunicações no PostgreSQL e avisa o frontend por SSE.

O firmware C++ ainda não faz parte desta entrega. Há um simulador MQTT para desenvolver e verificar a comunicação.

## Organização

```text
frontend/          React + Vite + Axios + Tailwind/shadcn; login e estado atual
backend/           NestJS, TypeORM/PostgreSQL, JWT, bcryptjs e MQTT
shared/            Tipos e validação do contrato MQTT v1
simulator/         Dispositivo MQTT simulado
infra/nginx/       Configuração do Nginx do host (systemd)
infra/mosquitto/   Configuração, ACLs e certificados do broker
scripts/          Provisionamento local de credenciais e usuário
```

O `package.json` da raiz organiza essas pastas como **npm workspaces**. Um `npm ci` instala as dependências do conjunto, e os comandos da raiz compilam os contratos antes dos serviços que os utilizam. Cada pacote mantém seu próprio `package.json`. O pacote `shared` é referenciado localmente como `@iot/contracts`, sem publicação em um registro externo.

- `simulator` executa um IoT fictício via MQTT para desenvolvimento e testes; não é um serviço do Compose de produção.
- `shared` contém os tipos da API e os schemas Zod das mensagens MQTT. Backend e simulador validam as mensagens em execução; o frontend utiliza os tipos TypeScript.
- `scripts` contém os utilitários de provisionamento: contas MQTT, primeiro usuário e preparação do ambiente de testes.
- `infra` contém a configuração do Nginx do host e do Mosquitto, seu script de inicialização e a pasta reservada aos certificados privados.

O frontend usa uma instância Axios com cookie, timeout e tratamento centralizado de erros. O SSE usa `EventSource` com o mesmo cookie e avisa quando consultar a API. A interface utiliza Tailwind CSS e componentes básicos do shadcn com variantes padrão; `frontend/src/styles.css` contém apenas o tema e a base.

Documentação: [plano](PLANO.md), [contrato HTTP e SSE](docs/API.md), [contrato MQTT](docs/MQTT.md).

## Servidor

```text
Internet → Nginx do HOST, systemd :443
             ├── /      → 127.0.0.1:4173 → frontend Docker
             └── /api/  → 127.0.0.1:3000 → NestJS Docker
                                          ├── PostgreSQL interno
                                          └── Mosquitto interno :1883
IoT → mqtt.seudominio.com:8883 → Mosquitto Docker (TLS)
```

O frontend usa um servidor estático Node no contêiner; não há Nginx em Docker. O banco não publica portas. Frontend e API publicam somente em `127.0.0.1`. O Nginx instalado no servidor faz o acesso público e mantém frontend, API e SSE na mesma origem.

### Preparação

Requisitos: Git, Docker Engine com Compose v2.24.4 ou superior, Nginx do host e Node.js 24 para os scripts de provisionamento. Os serviços em execução utilizam os próprios runtimes Docker.

1. Clone o projeto no servidor e entre na pasta.
2. Copie a configuração e preencha os valores:

   ```sh
   cp .env.example .env
   chmod 600 .env
   ```

   Defina `APP_ORIGIN` como a URL HTTPS real, `IOT_DEVICE_ID`, senhas diferentes para PostgreSQL/backend MQTT/IoT e dois segredos aleatórios diferentes para JWT e bootstrap. Para gerar cada segredo: `openssl rand -hex 32`. Mantenha `COOKIE_SECURE=true`. A aplicação recusa os placeholders da env.

3. Gere os hashes das contas MQTT e as permissões de tópicos:

   ```sh
   node scripts/configure-mqtt.mjs
   ```

   O script usa um contêiner temporário do Mosquitto e cria `infra/mosquitto/config/passwords` e `acl`, ignorados pelo Git. O arquivo contém hashes, não as senhas originais. Na inicialização, o broker copia hashes e ACLs para arquivos privados dentro do contêiner, pertencentes ao usuário Mosquitto. Não há conexão anônima. Para rotação intencional, use `--replace`, atualize o dispositivo e reinicie Mosquitto/backend. Trocar só a env não muda a senha do broker.

4. Configure DNS: `app.seudominio.com` e `mqtt.seudominio.com` apontam para o IP do servidor. O nome MQTT precisa permitir TCP direto; não depende de rotas HTTP.
5. Emita certificados válidos para esses nomes. Configure os caminhos web em `infra/nginx/iot.conf`. Para o broker, copie o certificado completo e a chave para:

   ```text
   infra/mosquitto/certs/fullchain.pem
   infra/mosquitto/certs/privkey.pem
   ```

   O processo Mosquitto, UID/GID 1883 na imagem usada, precisa ler os arquivos. No Linux, por exemplo: certificado com modo `644`, chave pertencente ao grupo `1883` com modo `640`, diretório acessível ao grupo. Não versionar esses arquivos. Se copiar de `/etc/letsencrypt`, a renovação deve copiar os novos arquivos e reiniciar o broker; para o Nginx, recarregar o serviço. Uma cópia estática não se renova sozinha.

6. Suba os serviços:

   ```sh
   docker compose up -d --build
   docker compose ps
   docker compose logs --tail=100 backend mosquitto
   ```

   O TypeORM executa as migrações versionadas no início do backend, com lock no PostgreSQL e `synchronize: false`. As entidades ficam em `backend/src/database/entities` e as migrações em `backend/src/database/migrations`. Bancos da versão SQL anterior são adotados sem recriar as tabelas, preservando usuários e histórico. O Mosquitto de produção exige certificados e credenciais provisionados; ele não inicia sem esses arquivos.

7. No Nginx do host, adapte o domínio/certificados e copie [iot.conf](infra/nginx/iot.conf) para o diretório de sites da distribuição. Em Debian/Ubuntu, depois de instalar o Nginx e obter os certificados:

   ```sh
   sudo cp infra/nginx/iot.conf /etc/nginx/sites-available/iot
   sudo ln -s /etc/nginx/sites-available/iot /etc/nginx/sites-enabled/iot
   sudo nginx -t
   sudo systemctl enable --now nginx
   sudo systemctl reload nginx
   ```

   Se o link já existir, preserve-o e atualize o arquivo. As portas públicas são **80/443 para web e 8883 para MQTT TLS**. Preserve também seu acesso SSH. PostgreSQL, API 3000, frontend 4173 e MQTT 1883 não devem ficar públicos.

8. Crie o primeiro usuário pela rota restrita, sem expor a senha no histórico do shell:

   ```sh
   node scripts/bootstrap-user.mjs
   ```

   O script lê o segredo da env e solicita e-mail/senha. A rota deixa de aceitar criação quando já existir usuário. Não há cadastro no frontend. O JWT dura 4 horas; após expirar, fazer login novamente.

9. Abra o domínio web. Configure o IoT com `mqtts://mqtt.seudominio.com:8883`, seu usuário/senha e o `IOT_DEVICE_ID` escolhido. O JWT web não é utilizado no dispositivo.

### Atualização após puxar o Git

```sh
git pull
docker compose up -d --build
```

Alterações de configuração do Nginx precisam de `nginx -t` e `systemctl reload nginx`. Reiniciar/recriar contêineres preserva os volumes. **Não use `docker compose down -v` no ambiente com dados:** isso remove volumes. Não há backup automático no MVP; o volume não protege contra perda do servidor.

## Desenvolvimento local

Requisitos: Node.js 24 e Docker/Compose. Use senhas e volumes próprios para desenvolvimento.

1. `npm ci`.
2. Copie `.env.example` para `.env`, substitua os segredos e configure:

   ```dotenv
   NODE_ENV=development
   APP_ORIGIN=http://localhost:5173
   COOKIE_SECURE=false
   POSTGRES_HOST=127.0.0.1
   MQTT_URL=mqtt://127.0.0.1:1883
   ```

3. Gere as contas: `node scripts/configure-mqtt.mjs`.
4. Inicie somente banco e broker em modo local, sem certificados:

   ```sh
   docker compose -f compose.yaml -f compose.dev.yaml up -d postgres mosquitto
   ```

5. Em terminais separados:

   ```sh
   npm run dev:backend
   npm run dev:frontend
   npm run simulate
   ```

6. Execute `node scripts/bootstrap-user.mjs` e abra **http://localhost:5173**. Use esse mesmo hostname para corresponder ao `APP_ORIGIN`.

No simulador, digite `agua`, `seco` ou `estado`. O comando `agua` permite testar uma solicitação rejeitada; a transição de `agua` para `seco` inicia um ciclo automático simulado. Inicialmente o sensor está sem água, permitindo testar solicitação manual. A duração padrão de 5 segundos e a publicação a cada 5 segundos são cenários do simulador, configuráveis com `SIMULATOR_FILL_SECONDS` e `SIMULATOR_HEARTBEAT_SECONDS`, e não decisões para o firmware final.

## Validação

```sh
npm run build
npm run typecheck
npm test
```

Integração real local, com projeto Docker, banco e contas de teste separados:

```sh
node scripts/prepare-test.mjs
docker compose -f compose.test.yaml up -d --wait
npm run build
npm run test:integration
docker compose -f compose.test.yaml down
```

O teste cria e remove um banco temporário dentro do PostgreSQL exclusivo de teste. Verifica bootstrap, hash, JWT/cookie, estados MQTT, histórico de inválidas/duplicatas, idempotência, aceite/rejeição, resposta tardia e SSE. Também verifica a adoção do esquema anterior pelo TypeORM, preservando os registros existentes. Os serviços de teste usam somente `127.0.0.1:15432` e `127.0.0.1:18884`, sem credenciais de produção.

## Limites do MVP

- Sem firmware C++, tela de histórico, cadastro de múltiplos dispositivos, refresh token ou backups.
- O horário sem `generatedAt` significa recebimento pelo backend; uma mensagem retida não comprova leitura recente.
- Histórico registra comunicações observadas; não promete recuperar tudo durante falhas de banco, broker ou backend. A sessão de comandos do IoT deve ser limpa, sem fila offline. O projeto não usa o histórico como fila para republicar comandos.
- Se o broker perder conexão, o último estado permanece disponível. A aceitação de um comando não comprova acionamento físico; o painel aguarda telemetria para mudar a bomba.
