import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
mkdirSync('.local/test-mqtt', { recursive: true });
writeFileSync(
  '.local/test.env',
  'IOT_DEVICE_ID=caixa-test\nMQTT_USERNAME=backend-test\nMQTT_PASSWORD=backend-integration-only\nMQTT_DEVICE_USERNAME=iot-test\nMQTT_DEVICE_PASSWORD=device-integration-only\n',
  { mode: 0o600 },
);
writeFileSync(
  '.local/test-mqtt/mosquitto.conf',
  'listener 1883\nallow_anonymous false\npassword_file /mosquitto/config/passwords\nacl_file /mosquitto/config/acl\nlog_dest stdout\n',
);
const result = spawnSync(process.execPath, ['scripts/configure-mqtt.mjs', '--replace'], {
  stdio: 'inherit',
  env: { ...process.env, MQTT_ENV_FILE: '.local/test.env', MQTT_CONFIG_DIR: '.local/test-mqtt' },
});
process.exitCode = result.status ?? 1;
