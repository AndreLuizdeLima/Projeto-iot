# Contrato MQTT v1

Fonte executável: [`shared/src/index.ts`](../shared/src/index.ts), compartilhada pelo backend e simulador. JSON UTF-8, QoS 1. O frontend utiliza somente os tipos da API, sem MQTT e sem credenciais do broker.

Prefixo único: `iot/v1/dispositivos/{IOT_DEVICE_ID}`.

| Sufixo             | Publicador          | Retain | Conteúdo          |
| ------------------ | ------------------- | ------ | ----------------- |
| `/estado`          | IoT                 | Sim    | `DeviceState`     |
| `/disponibilidade` | IoT / LWT do broker | Sim    | `Availability`    |
| `/comandos`        | Backend             | Não    | `FillCommand`     |
| `/respostas`       | IoT                 | Não    | `CommandResponse` |

## Estado

```json
{
  "schemaVersion": 1,
  "deviceId": "caixa-001",
  "bootId": "identificador-novo-a-cada-reinicio",
  "sequence": 1,
  "uptimeMs": 1000,
  "generatedAt": "2026-11-15T12:00:00.000Z",
  "sensor": { "ativo": false, "nivel": "sem_agua" },
  "bomba": { "status": "desligada" },
  "enchimento": {
    "status": "parado",
    "cicloId": null,
    "origem": null,
    "commandId": null
  },
  "falha": null
}
```

- Sensor: `ativo` é `true`, `false` ou `null`, correspondendo respectivamente a `com_agua`, `sem_agua` e `desconhecido`.
- Bomba: `ligada`, `desligada` ou `desconhecido`, informando a saída de controle; sem comprovação mecânica ou de vazão.
- Enchimento: `parado`, `enchendo`, `concluido`, `falha` ou `desconhecido`; origem `manual`, `automatico` ou `null`.
- `generatedAt` é opcional; enviar somente quando o dispositivo tiver relógio sincronizado. O backend sempre registra também seu próprio horário de recebimento.
- `duracaoConfiguradaSegundos` e `tempoRestanteSegundos` são opcionais/nulos. Quando informados, são inteiros não negativos. Zero pode comunicar configuração inválida junto de uma falha. Não há temporizador de controle no backend.
- Códigos e mensagens de falha são informados pelo dispositivo; o sistema não decide as regras físicas.
- `sequence` aumenta dentro do mesmo `bootId`. Duplicatas/estados antigos são guardados no histórico, mas não substituem o snapshot. Retidos de outro boot não substituem um estado existente. Estados novos ao vivo podem iniciar outro boot.
- O dispositivo define quando e com que frequência publica; mensagens devem conter um retrato completo. Não é necessário implementar frequência definida pelo backend.

## Disponibilidade

```json
{ "schemaVersion": 1, "deviceId": "caixa-001", "bootId": "boot-atual", "status": "online" }
```

Configurar LWT com o mesmo formato e `status: "offline"`, QoS 1, retain=true. Publicar `online` ao conectar. O status representa o último aviso, separado da conexão do backend com o broker. Uma leitura antiga ou ausência de mensagem não será convertida em “caixa vazia” ou “bomba desligada”.

## Comando e resposta

```json
{
  "schemaVersion": 1,
  "deviceId": "caixa-001",
  "commandId": "0dabf06b-ea23-4a39-bd4d-a56857153118",
  "targetBootId": "boot-atual",
  "tipo": "encher"
}
```

O backend não manda duração. O IoT decide e responde:

```json
{
  "schemaVersion": 1,
  "deviceId": "caixa-001",
  "bootId": "boot-atual",
  "commandId": "0dabf06b-ea23-4a39-bd4d-a56857153118",
  "status": "aceito",
  "cicloId": "identificador-do-ciclo"
}
```

Ou `status: "rejeitado"`, `motivo: "ENCHIMENTO_NAO_PERMITIDO"` e `mensagem` opcional. Motivos são strings limitadas, permitindo novas proteções no firmware sem alterar o backend. Respostas também podem incluir `generatedAt`.

O IoT deve rejeitar comandos de outro `targetBootId` e deduplicar `commandId` dentro de sua inicialização, sem iniciar outro ciclo nem estender a bomba. O simulador guarda os últimos 1.000 resultados; a política definitiva do hardware será definida no firmware.

Configurar sessão limpa no dispositivo para não receber comandos enfileirados de conexões anteriores; não reter comandos ou respostas. O backend usa uma conexão curta sem reconexão para cada publicação, com expiração MQTT 5 de 5 segundos no broker. Não há reenvio de aplicação após falha. Confirmação de entrega MQTT não é aceitação pelo dispositivo.

O backend arquiva toda resposta observada. Só altera a solicitação correspondente se o identificador do dispositivo, boot e comando coincidirem. Duplicatas não sobrescrevem decisões já registradas. Resposta tardia pode corrigir um resultado previamente desconhecido.
