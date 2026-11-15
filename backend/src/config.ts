import { z } from 'zod';
import { deviceIdSchema } from '@iot/contracts';

const envSchema = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url().transform((value) => new URL(value).origin),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  JWT_SECRET: z.string().min(32),
  BOOTSTRAP_SECRET: z.string().min(32),
  POSTGRES_HOST: z.string().default('postgres'),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  IOT_DEVICE_ID: deviceIdSchema,
  MQTT_URL: z.string().regex(/^mqtts?:\/\//),
  MQTT_USERNAME: z.string().min(1),
  MQTT_PASSWORD: z.string().min(1),
  COMMAND_RESPONSE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(15),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Configuração inválida: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  for (const name of ['JWT_SECRET', 'BOOTSTRAP_SECRET', 'POSTGRES_PASSWORD', 'MQTT_PASSWORD'] as const) {
    if (result.data[name].startsWith('SUBSTITUA')) throw new Error(`Defina um valor real para ${name}.`);
  }
  if (
    result.data.NODE_ENV === 'production' &&
    (result.data.COOKIE_SECURE !== 'true' || !result.data.APP_ORIGIN.startsWith('https://'))
  ) {
    throw new Error('Produção exige APP_ORIGIN HTTPS e COOKIE_SECURE=true.');
  }
  return result.data;
}
export type Config = ReturnType<typeof readConfig>;
export const CONFIG = Symbol('CONFIG');
