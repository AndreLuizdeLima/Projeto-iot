import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { connect } from 'mqtt';
import { commandSchema, topics, type CommandResponse, type DeviceState } from '@iot/contracts';

const deviceId = process.env.IOT_DEVICE_ID ?? 'caixa-001';
const url = process.env.SIMULATOR_MQTT_URL ?? 'mqtt://127.0.0.1:1883';
const username = process.env.MQTT_DEVICE_USERNAME;
const password = process.env.MQTT_DEVICE_PASSWORD;
if (!username || !password) throw new Error('Configure MQTT_DEVICE_USERNAME e MQTT_DEVICE_PASSWORD.');
const bootId = randomUUID();
const started = Date.now();
const channel = topics(deviceId);
const duration = Number(process.env.SIMULATOR_FILL_SECONDS ?? 5);
const heartbeat = Number(process.env.SIMULATOR_HEARTBEAT_SECONDS ?? 5);
if (!Number.isInteger(duration) || duration < 1 || !Number.isInteger(heartbeat) || heartbeat < 1)
  throw new Error('Tempos do simulador devem ser inteiros positivos.');
let sequence = 0;
let endAt = 0;
let fillTimer: NodeJS.Timeout | undefined;
const responses = new Map<string, CommandResponse>();
const state: DeviceState = {
  schemaVersion: 1,
  deviceId,
  bootId,
  sequence: 0,
  uptimeMs: 0,
  sensor: { ativo: false, nivel: 'sem_agua' },
  bomba: { status: 'desligada' },
  enchimento: {
    status: 'parado',
    cicloId: null,
    origem: null,
    commandId: null,
    duracaoConfiguradaSegundos: duration,
    tempoRestanteSegundos: 0,
  },
  falha: null,
};
const client = connect(url, {
  username,
  password,
  clientId: `simulator-${deviceId}`,
  clean: true,
  protocolVersion: 5,
  reconnectPeriod: 3000,
  will: {
    topic: channel.availability,
    payload: JSON.stringify({ schemaVersion: 1, deviceId, bootId, status: 'offline' }),
    qos: 1,
    retain: true,
  },
});
function publishState() {
  if (!client.connected) return;
  state.sequence = ++sequence;
  state.uptimeMs = Date.now() - started;
  state.generatedAt = new Date().toISOString();
  state.enchimento.tempoRestanteSegundos = endAt ? Math.max(0, Math.ceil((endAt - Date.now()) / 1000)) : 0;
  client.publish(channel.state, JSON.stringify(state), { qos: 1, retain: true });
}
function availability(status: 'online' | 'offline') {
  return client.publishAsync(
    channel.availability,
    JSON.stringify({ schemaVersion: 1, deviceId, bootId, status }),
    { qos: 1, retain: true },
  );
}
function startFill(origin: 'manual' | 'automatico', commandId: string | null) {
  const cicloId = randomUUID();
  state.bomba.status = 'ligada';
  state.enchimento = {
    status: 'enchendo',
    cicloId,
    origem: origin,
    commandId,
    duracaoConfiguradaSegundos: duration,
    tempoRestanteSegundos: duration,
  };
  endAt = Date.now() + duration * 1000;
  fillTimer = setTimeout(() => {
    state.bomba.status = 'desligada';
    state.enchimento.status = 'concluido';
    endAt = 0;
    // Cenário do simulador: completar o ciclo faz o sensor detectar água.
    state.sensor = { ativo: true, nivel: 'com_agua' };
    publishState();
    console.log('Ciclo simulado concluído.');
  }, duration * 1000);
  return cicloId;
}
client.on('connect', () => {
  client.subscribe(channel.commands, { qos: 1 }, async (error) => {
    if (error) return console.error('Não foi possível assinar comandos.');
    await availability('online');
    publishState();
    console.log(`Simulador conectado: ${deviceId}. Digite: agua, seco ou estado.`);
  });
});
client.on('error', () => console.error('MQTT indisponível: confira endereço e credenciais.'));
client.on('message', (_topic, buffer, packet) => {
  if (packet.retain) return;
  let json: unknown;
  try {
    json = JSON.parse(buffer.toString());
  } catch {
    return;
  }
  const parsed = commandSchema.safeParse(json);
  if (!parsed.success || parsed.data.deviceId !== deviceId) return;
  const command = parsed.data;
  let response = responses.get(command.commandId);
  if (!response) {
    const base = {
      schemaVersion: 1 as const,
      deviceId,
      bootId,
      commandId: command.commandId,
      generatedAt: new Date().toISOString(),
    };
    if (command.targetBootId !== bootId)
      response = { ...base, status: 'rejeitado', motivo: 'SESSAO_INVALIDA' };
    else if (state.enchimento.status === 'enchendo')
      response = { ...base, status: 'rejeitado', motivo: 'JA_ENCHENDO' };
    else if (state.sensor.ativo)
      response = { ...base, status: 'rejeitado', motivo: 'ENCHIMENTO_NAO_PERMITIDO' };
    else response = { ...base, status: 'aceito', cicloId: startFill('manual', command.commandId) };
    responses.set(command.commandId, response);
    if (responses.size > 1000) responses.delete(responses.keys().next().value!);
  }
  client.publish(channel.responses, JSON.stringify(response), { qos: 1, retain: false });
  publishState();
});
const timer = setInterval(() => {
  if (client.connected) {
    void availability('online');
    publishState();
  }
}, heartbeat * 1000);
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === 'agua') {
    state.sensor = { ativo: true, nivel: 'com_agua' };
    publishState();
  }
  if (line.trim() === 'seco') {
    const wasWet = state.sensor.ativo;
    state.sensor = { ativo: false, nivel: 'sem_agua' };
    if (wasWet && state.enchimento.status !== 'enchendo') startFill('automatico', null);
    publishState();
  }
  if (line.trim() === 'estado') {
    publishState();
    console.log(JSON.stringify(state, null, 2));
  }
});
async function stop() {
  clearInterval(timer);
  clearTimeout(fillTimer);
  state.bomba.status = 'desligada';
  if (client.connected) await availability('offline').catch(() => {});
  await client.endAsync(true);
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
