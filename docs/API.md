# Contrato HTTP do MVP

Externamente, todas as rotas abaixo têm o prefixo `/api`. O Nginx do host remove esse prefixo e encaminha a requisição ao NestJS. Em desenvolvimento, o Vite faz o mesmo. O dispositivo único vem de `IOT_DEVICE_ID`. O cliente HTTP do frontend é uma instância Axios com cookie e tratamento centralizado de erros; a troca do cliente e a persistência via TypeORM preservam as rotas e os formatos documentados abaixo.

## Autenticação

`POST /auth/bootstrap` recebe `{ "email": "voce@example.com", "password": "..." }` e exige `X-Bootstrap-Secret`, igual à configuração privada do servidor. Retorna `201` com `{ id, email }`. Após existir qualquer usuário, retorna `409`. Não há tela de cadastro. Senhas: mínimo de 8 caracteres e máximo de 72 bytes, hash bcrypt com custo 12. A criação é serializada no PostgreSQL para evitar dois usuários iniciais concorrentes.

`POST /auth/login` recebe o mesmo corpo e retorna `200` com `{ user: { id, email }, expiresAt }`. Define o JWT HS256 em `iot_session`, cookie HttpOnly, SameSite=Strict, Secure em produção, duração de 4 horas. O token não é retornado no corpo e não vai para localStorage. Credenciais inválidas: `401`. Não há refresh token no MVP: após expirar, fazer login novamente.

`GET /auth/me` exige cookie válido e retorna a sessão. `POST /auth/logout` limpa o cookie e retorna `204`. O logout encerra a sessão no navegador; um JWT já copiado continua válido até expirar, pois não há lista de revogação no MVP. Origens de navegador diferentes de `APP_ORIGIN` são rejeitadas nas requisições de escrita.

## Estado atual

`GET /dispositivo` exige cookie e retorna o tipo `Dashboard` de [`shared/src/index.ts`](../shared/src/index.ts):

- `deviceId`: identificador configurado.
- `brokerConnected`: conexão atual do backend com o broker, independente do aviso do IoT.
- `availability`: último aviso do dispositivo, horário de recebimento e indicador de mensagem retida; ou `null`.
- `state`: último estado válido aplicável; ou `null` antes da primeira leitura.
- `receivedAt`: horário de recebimento desse estado em UTC; não é regravado por duplicatas.
- `retained`: informa se o snapshot veio de mensagem retida.
- `lastCommand`: última solicitação manual, com resposta e horários; ou `null`.

Não existem rotas ou telas de histórico nesta etapa. Toda comunicação MQTT observada é persistida no PostgreSQL, incluindo inválidas e duplicatas. O estado atual só muda com uma mensagem válida aplicável. O frontend usa `generatedAt` quando fornecido pelo IoT e identifica o horário como “Gerado em”; sem esse campo, usa “Recebido em”.

## Solicitar enchimento

`POST /dispositivos/:deviceId/encher` exige cookie, corpo `{}` e o cabeçalho `Idempotency-Key` com UUID. Não recebe duração nem decisão física. Responde `202` com `CommandView`:

```json
{
  "commandId": "0dabf06b-ea23-4a39-bd4d-a56857153118",
  "status": "pendente",
  "requestedAt": "2026-11-15T12:00:00.000Z",
  "respondedAt": null,
  "response": null
}
```

O backend verifica apenas autenticação, identificador configurado, broker conectado e último aviso de disponibilidade online. Não calcula permissão pelo nível, pelo estado da bomba ou pela idade da leitura. O IoT aceita ou rejeita. Um aviso online é o último informado e não garante conectividade instantânea.

A mesma chave e usuário retornam a solicitação existente, sem republicar o comando. Chaves já utilizadas por outro usuário retornam conflito. O frontend preserva a chave após falha de rede para que a repetição da mesma tentativa não gere outro comando.

Estados da solicitação:

| Estado         | Significado                                                            |
| -------------- | ---------------------------------------------------------------------- |
| `pendente`     | Registrada; aguardando resposta do IoT.                                |
| `aceito`       | IoT aceitou; consultar estado para acompanhar a bomba.                 |
| `rejeitado`    | IoT rejeitou; a resposta contém o motivo informado pelo dispositivo.   |
| `sem_resposta` | Prazo de resposta vencido; resultado físico desconhecido.              |
| `falha_envio`  | Publicação não confirmada; não comprova que o dispositivo não recebeu. |

Uma resposta válida tardia pode substituir `sem_resposta` ou `falha_envio`. Aceitação não altera por si só o estado da bomba. Não há reenvio automático de comando. O prazo padrão de resposta é 15 segundos, configurável no backend; não interfere na duração da bomba.

Erros: `400` para chave inválida, `401` sem sessão, `404` para outro dispositivo, `409` sem aviso online ou chave em conflito, `503` se o broker estiver desconectado. Mensagens de erro usam `{ statusCode, message, error }` nas exceções de API. Falha de banco não é tratada como sucesso.

## SSE

`GET /eventos` exige cookie e usa `text/event-stream`:

```text
event: dispositivo.atualizado
id: UUID-do-evento
data: {"deviceId":"caixa-001"}

```

Ao receber esse evento, consultar `GET /dispositivo`. Não há telemetria completa no SSE. O backend publica o aviso depois do commit de uma alteração consultável, inclusive respostas e tempo esgotado de comandos. Mudanças da conexão com o broker também provocam aviso.

Há um evento inicial `conectado` e um `heartbeat` a cada 15 segundos para manter o proxy ativo. Esses heartbeats não são a frequência MQTT do dispositivo. A conexão SSE é encerrada ao expirar o JWT. Após reconexão, o frontend consulta novamente o snapshot; não há replay de eventos SSE nem exigência de `Last-Event-ID` no MVP. Avisos durante uma consulta provocam outra consulta ao terminar.

## Operação

`GET /health` não exige autenticação. Retorna `{ status: "ok", database: "connected", mqtt: "connected" | "disconnected" }`. Banco indisponível retorna `503`. A disponibilidade do broker é reportada separadamente, para não bloquear login e consulta dos últimos dados durante sua desconexão.
