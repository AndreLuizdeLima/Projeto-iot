import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

test('TypeORM adota o esquema anterior preservando usuário e histórico', { timeout: 20000 }, async () => {
  const { createDataSource } = await import('../../dist/database/data-source.js');
  const { readConfig } = await import('../../dist/config.js');
  const { initialSchemaSql } = await import('../../dist/database/migrations/1794700800000-initial-schema.js');
  const connection = {
    host: '127.0.0.1',
    port: 15432,
    user: 'iot_test',
    password: 'integration-only-password',
  };
  const admin = new Pool({ ...connection, database: 'iot_integration' });
  const database = `iot_legacy_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  const previous = new Pool({ ...connection, database });
  const source = createDataSource(
    readConfig({
      NODE_ENV: 'test',
      APP_ORIGIN: 'http://localhost:13000',
      COOKIE_SECURE: 'false',
      JWT_SECRET: 'legacy-test-jwt-secret-more-than-32-characters',
      BOOTSTRAP_SECRET: 'legacy-test-bootstrap-secret-more-than-32-characters',
      POSTGRES_HOST: connection.host,
      POSTGRES_PORT: String(connection.port),
      POSTGRES_USER: connection.user,
      POSTGRES_PASSWORD: connection.password,
      POSTGRES_DB: database,
      IOT_DEVICE_ID: 'caixa-test',
      MQTT_URL: 'mqtt://127.0.0.1:18884',
      MQTT_USERNAME: 'backend-test',
      MQTT_PASSWORD: 'backend-integration-only',
    }),
  );
  try {
    await previous.query(
      'CREATE TABLE schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    await previous.query(initialSchemaSql);
    await previous.query('INSERT INTO schema_migrations(version) VALUES (1)');
    const userId = randomUUID();
    const passwordHash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxdtVh9l7NfRS.oJcFbqTrV9XQy';
    await previous.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
      userId,
      'anterior@example.com',
      passwordHash,
    ]);
    await previous.query(
      `INSERT INTO mqtt_messages(device_id,direction,topic,payload,qos,retained,valid) VALUES('caixa-test','recebida','historico','{"anterior":true}',1,false,true)`,
    );
    await source.initialize();
    assert.equal((await source.runMigrations({ transaction: 'all' })).length, 1);
    assert.equal((await source.runMigrations({ transaction: 'all' })).length, 0);
    const users = await previous.query('SELECT id,email,password_hash FROM users');
    assert.deepEqual(users.rows, [
      { id: userId, email: 'anterior@example.com', password_hash: passwordHash },
    ]);
    const messages = await previous.query('SELECT payload FROM mqtt_messages');
    assert.deepEqual(messages.rows, [{ payload: '{"anterior":true}' }]);
    assert.equal(
      (await previous.query('SELECT count(*)::int AS total FROM typeorm_migrations')).rows[0].total,
      1,
    );
  } finally {
    if (source.isInitialized) await source.destroy();
    await previous.end();
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
  }
});
