import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { connectAsync, type MqttClient } from 'mqtt';
import { topics, type Dashboard, type DeviceState, type FillCommand } from '@iot/contracts';

const root = new URL('../../..', import.meta.url);
const port = 13000;
const url = `http://127.0.0.1:${port}`;
const deviceId = 'caixa-test';
const channel = topics(deviceId);
const bootstrapSecret = 'test-bootstrap-secret-with-more-than-32-characters';
const jwtSecret = 'test-jwt-secret-with-more-than-32-characters';

async function until<T>(action: () => Promise<T>, predicate: (value: T) => boolean, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await action();
      if (predicate(value)) return value;
    } catch {}
    await delay(80);
  }
  throw new Error('Condição não atingida dentro do prazo do teste.');
}

test('MVP integrado com PostgreSQL e Mosquitto reais', { timeout: 60000 }, async (t) => {
  const admin = new Pool({
    host: '127.0.0.1',
    port: 15432,
    user: 'iot_test',
    password: 'integration-only-password',
    database: 'iot_integration',
  });
  const database = `iot_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  let backend: ChildProcess | undefined;
  let device: MqttClient | undefined;
  const db = new Pool({
    host: '127.0.0.1',
    port: 15432,
    user: 'iot_test',
    password: 'integration-only-password',
    database,
  });
  let output = '';
  t.after(async () => {
    if (device) await device.endAsync(true);
    if (backend && backend.exitCode === null) {
      const exited = new Promise((resolve) => backend!.once('exit', resolve));
      backend.kill('SIGTERM');
      await Promise.race([exited, delay(3000)]);
      if (backend.exitCode === null) backend.kill('SIGKILL');
    }
    await db.end();
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
    if (t.signal.aborted) console.error(output);
  });
  backend = spawn(process.execPath, ['backend/dist/main.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      APP_ORIGIN: url,
      COOKIE_SECURE: 'false',
      JWT_SECRET: jwtSecret,
      BOOTSTRAP_SECRET: bootstrapSecret,
      POSTGRES_HOST: '127.0.0.1',
      POSTGRES_PORT: '15432',
      POSTGRES_DB: database,
      POSTGRES_USER: 'iot_test',
      POSTGRES_PASSWORD: 'integration-only-password',
      IOT_DEVICE_ID: deviceId,
      MQTT_URL: 'mqtt://127.0.0.1:18884',
      MQTT_USERNAME: 'backend-test',
      MQTT_PASSWORD: 'backend-integration-only',
      COMMAND_RESPONSE_TIMEOUT_SECONDS: '2',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stdout?.on('data', (data) => {
    output += data;
  });
  backend.stderr?.on('data', (data) => {
    output += data;
  });
  try {
    await until(
      async () => (await fetch(`${url}/health`)).json(),
      (body) => body.mqtt === 'connected',
      20000,
    );
  } catch (error) {
    console.error(output);
    throw error;
  }
  const call = (path: string, options: RequestInit = {}) => fetch(`${url}${path}`, options);
  const credentials = { email: 'teste@example.com', password: 'senha-teste-12345' };
  const json = { 'Content-Type': 'application/json' };
  let cookie = '';
  await t.test('bootstrap restrito e único; bcrypt; login e cookie JWT de 4 horas', async () => {
    const unauthorized = await call('/auth/bootstrap', {
      method: 'POST',
      headers: json,
      body: JSON.stringify(credentials),
    });
    assert.equal(unauthorized.status, 401);
    const created = await call('/auth/bootstrap', {
      method: 'POST',
      headers: { ...json, 'X-Bootstrap-Secret': bootstrapSecret },
      body: JSON.stringify(credentials),
    });
    assert.equal(created.status, 201);
    const second = await call('/auth/bootstrap', {
      method: 'POST',
      headers: { ...json, 'X-Bootstrap-Secret': bootstrapSecret },
      body: JSON.stringify(credentials),
    });
    assert.equal(second.status, 409);
    const stored = await db.query('SELECT password_hash FROM users');
    assert.match(stored.rows[0].password_hash, /^\$2[aby]\$/);
    assert.notEqual(stored.rows[0].password_hash, credentials.password);
    const bad = await call('/auth/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ ...credentials, password: 'senha-incorreta' }),
    });
    assert.equal(bad.status, 401);
    const login = await call('/auth/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify(credentials),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie')!;
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Max-Age=14400/);
    cookie = setCookie.split(';')[0];
    const session = await login.json();
    assert.ok(new Date(session.expiresAt).getTime() > Date.now() + 14300000);
    assert.equal((await call('/dispositivo')).status, 401);
    assert.equal(
      (await call('/auth/logout', { method: 'POST', headers: { Origin: 'https://outro-site.example' } }))
        .status,
      403,
    );
  });
  const dashboard = async (): Promise<Dashboard> =>
    (await call('/dispositivo', { headers: { Cookie: cookie } })).json();
  const received: FillCommand[] = [];
  const bootId = randomUUID();
  device = await connectAsync('mqtt://127.0.0.1:18884', {
    username: 'iot-test',
    password: 'device-integration-only',
    clientId: `device-test-${randomUUID()}`,
    protocolVersion: 5,
    reconnectPeriod: 0,
  });
  await device.subscribeAsync(channel.commands, { qos: 1 });
  device.on('message', (_topic, payload) => {
    received.push(JSON.parse(payload.toString()));
  });
  const publish = (topic: string, value: unknown) =>
    device!.publishAsync(topic, JSON.stringify(value), { qos: 1, retain: false });
  const state: DeviceState = {
    schemaVersion: 1,
    deviceId,
    bootId,
    sequence: 1,
    uptimeMs: 100,
    sensor: { ativo: true, nivel: 'com_agua' },
    bomba: { status: 'desligada' },
    enchimento: { status: 'parado', cicloId: null, commandId: null, origem: null },
    falha: null,
  };
  await publish(channel.availability, { schemaVersion: 1, deviceId, bootId, status: 'online' });
  await publish(channel.state, state);
  await t.test('preserva histórico de inválidas e duplicatas sem sobrescrever estado atual', async () => {
    await until(dashboard, (data) => data.state?.sequence === 1);
    await publish(channel.state, state);
    await publish(channel.state, { ...state, sensor: { ativo: false, nivel: 'com_agua' } });
    await device!.publishAsync(channel.state, '{json inválido', { qos: 1 });
    await until(
      async () =>
        (await db.query('SELECT count(*)::int AS total FROM mqtt_messages WHERE NOT valid')).rows[0].total,
      (n) => n === 2,
    );
    const data = await dashboard();
    assert.equal(data.state?.sensor.ativo, true);
    const count = await db.query('SELECT count(*)::int AS total FROM mqtt_messages');
    assert.ok(count.rows[0].total >= 5);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS total FROM mqtt_messages WHERE payload_base64 IS NOT NULL AND observed_at IS NOT NULL',
        )
      ).rows[0].total,
      count.rows[0].total,
    );
  });
  let commandId = randomUUID();
  const fill = (id: string) =>
    call(`/dispositivos/${deviceId}/encher`, {
      method: 'POST',
      headers: { ...json, Cookie: cookie, 'Idempotency-Key': id },
      body: '{}',
    });
  await t.test(
    'encaminha mesmo com água no sensor; SSE notifica rejeição e repetição HTTP não duplica comando',
    async () => {
      const abort = new AbortController();
      const stream = await call('/eventos', { headers: { Cookie: cookie }, signal: abort.signal });
      assert.equal(stream.status, 200);
      const reader = stream.body!.getReader();
      const decoder = new TextDecoder();
      let events = '';
      const reading = (async () => {
        try {
          while (true) {
            const item = await reader.read();
            if (item.done) break;
            events += decoder.decode(item.value);
          }
        } catch {}
      })();
      try {
        assert.equal((await fill(commandId)).status, 202);
        await until(
          async () => received,
          (messages) => messages.some((item) => item.commandId === commandId),
        );
        assert.equal((await fill(commandId)).status, 202);
        await delay(150);
        assert.equal(received.filter((item) => item.commandId === commandId).length, 1);
        await publish(channel.responses, {
          schemaVersion: 1,
          deviceId,
          bootId,
          commandId,
          status: 'rejeitado',
          motivo: 'ENCHIMENTO_NAO_PERMITIDO',
        });
        const data = await until(dashboard, (data) => data.lastCommand?.status === 'rejeitado');
        assert.equal(data.state?.sensor.ativo, true);
        assert.ok(data.lastCommand?.respondedAt);
        await until(
          async () => events,
          (text) => text.includes('event: dispositivo.atualizado'),
        );
        assert.ok(!events.includes('sensor'));
      } finally {
        abort.abort();
        await reading;
      }
    },
  );
  await t.test(
    'sem resposta mantém o último estado; resposta tardia atualiza solicitação; aceite não inventa acionamento',
    async () => {
      commandId = randomUUID();
      assert.equal((await fill(commandId)).status, 202);
      const expired = await until(dashboard, (data) => data.lastCommand?.status === 'sem_resposta');
      assert.equal(expired.state?.bomba.status, 'desligada');
      const cicloId = randomUUID();
      await publish(channel.responses, {
        schemaVersion: 1,
        deviceId,
        bootId,
        commandId,
        status: 'aceito',
        cicloId,
      });
      const accepted = await until(dashboard, (data) => data.lastCommand?.status === 'aceito');
      assert.equal(accepted.state?.bomba.status, 'desligada');
      await publish(channel.state, {
        ...state,
        sequence: 2,
        sensor: { ativo: false, nivel: 'sem_agua' },
        bomba: { status: 'ligada' },
        enchimento: { status: 'enchendo', cicloId, commandId, origem: 'manual' },
      });
      await until(dashboard, (data) => data.state?.bomba.status === 'ligada');
    },
  );
  await t.test(
    'preserva estado ao ficar offline e recusa encaminhamento para dispositivo explicitamente offline',
    async () => {
      await publish(channel.availability, { schemaVersion: 1, deviceId, bootId, status: 'offline' });
      await until(dashboard, (data) => data.availability?.status === 'offline');
      assert.equal((await fill(randomUUID())).status, 409);
      assert.equal((await dashboard()).state?.bomba.status, 'ligada');
    },
  );
  await t.test('logout remove cookie e expiração invalida API e SSE', async () => {
    const logout = await call('/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
    const { JwtService } = await import('@nestjs/jwt');
    const jwt = new JwtService();
    const token = await jwt.signAsync(
      { sub: randomUUID(), email: credentials.email },
      { secret: jwtSecret, expiresIn: -1 },
    );
    for (const path of ['/dispositivo', '/eventos'])
      assert.equal((await call(path, { headers: { Cookie: `iot_session=${token}` } })).status, 401);
  });
});
