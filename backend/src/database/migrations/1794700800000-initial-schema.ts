import { MigrationInterface, QueryRunner } from 'typeorm';

export const initialSchemaSql = `
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mqtt_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id text,
  direction text NOT NULL CHECK (direction IN ('recebida', 'enviada')),
  topic text NOT NULL,
  payload text NOT NULL,
  payload_base64 text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  qos smallint NOT NULL,
  retained boolean NOT NULL DEFAULT false,
  valid boolean NOT NULL,
  validation_error text,
  metadata jsonb NOT NULL DEFAULT '{}',
  delivery_status text,
  delivery_error text
);
CREATE INDEX mqtt_messages_device_time ON mqtt_messages (device_id, observed_at DESC);
CREATE TABLE device_state (
  device_id text PRIMARY KEY,
  state jsonb NOT NULL,
  received_at timestamptz NOT NULL,
  retained boolean NOT NULL
);
CREATE TABLE device_availability (
  device_id text PRIMARY KEY,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL,
  retained boolean NOT NULL
);
CREATE TABLE commands (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  device_id text NOT NULL,
  target_boot_id text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pendente', 'aceito', 'rejeitado', 'sem_resposta', 'falha_envio')),
  responded_at timestamptz,
  response jsonb
);
CREATE INDEX commands_device_time ON commands (device_id, requested_at DESC);
`;

export class InitialSchema1794700800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    // Adota o esquema anterior sem recriar tabelas nem remover seus dados.
    if (await queryRunner.hasTable('schema_migrations')) {
      const applied: { version: number }[] = await queryRunner.query(
        'SELECT version FROM schema_migrations WHERE version = 1',
      );
      if (applied.length) {
        for (const table of ['users', 'mqtt_messages', 'device_state', 'device_availability', 'commands']) {
          if (!(await queryRunner.hasTable(table))) throw new Error(`Esquema anterior incompleto: ${table}.`);
        }
        return;
      }
    }
    await queryRunner.query(initialSchemaSql);
  }

  async down() {
    throw new Error('A migração inicial preserva os dados e não oferece reversão destrutiva automática.');
  }
}
