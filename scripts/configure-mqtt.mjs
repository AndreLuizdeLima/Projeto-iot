import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
process.loadEnvFile(process.env.MQTT_ENV_FILE ?? '.env');
const deviceId = process.env.IOT_DEVICE_ID;
const backend = process.env.MQTT_USERNAME;
const device = process.env.MQTT_DEVICE_USERNAME;
for (const value of [deviceId, backend, device]) {
  if (!value || !/^[a-zA-Z0-9_-]{1,64}$/.test(value))
    throw new Error('Identificador/usuário MQTT inválido na env.');
}
if (backend === device) throw new Error('Use contas distintas para backend e IoT.');
for (const key of ['MQTT_PASSWORD', 'MQTT_DEVICE_PASSWORD']) {
  if (!process.env[key] || process.env[key].startsWith('SUBSTITUA')) throw new Error(`Defina ${key}.`);
}
const target = process.env.MQTT_CONFIG_DIR ?? 'infra/mosquitto/config';
mkdirSync(target, { recursive: true });
if (existsSync(`${target}/passwords`) && !process.argv.includes('--replace'))
  throw new Error('Credenciais já existem. Para rotação intencional, utilize --replace e reinicie o broker.');
const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--network',
    'none',
    '--entrypoint',
    'sh',
    '-e',
    'MQTT_USERNAME',
    '-e',
    'MQTT_PASSWORD',
    '-e',
    'MQTT_DEVICE_USERNAME',
    '-e',
    'MQTT_DEVICE_PASSWORD',
    'eclipse-mosquitto:2.0',
    '-ec',
    'mosquitto_passwd -b -c /tmp/passwords "$MQTT_USERNAME" "$MQTT_PASSWORD"; mosquitto_passwd -b /tmp/passwords "$MQTT_DEVICE_USERNAME" "$MQTT_DEVICE_PASSWORD"; cat /tmp/passwords',
  ],
  { encoding: 'utf8', env: process.env },
);
if (result.status !== 0) {
  console.error(result.stderr);
  throw new Error('Falha ao gerar arquivo de senhas MQTT.');
}
writeFileSync(`${target}/passwords`, result.stdout, { mode: 0o644 });
const prefix = `iot/v1/dispositivos/${deviceId}`;
writeFileSync(
  `${target}/acl`,
  `user ${backend}\ntopic write ${prefix}/comandos\ntopic read ${prefix}/estado\ntopic read ${prefix}/disponibilidade\ntopic read ${prefix}/respostas\n\nuser ${device}\ntopic read ${prefix}/comandos\ntopic write ${prefix}/estado\ntopic write ${prefix}/disponibilidade\ntopic write ${prefix}/respostas\n`,
  { mode: 0o644 },
);
console.log('Arquivo de hashes e ACL criados. Nenhuma senha foi exibida.');
