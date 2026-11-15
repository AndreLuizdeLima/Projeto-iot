import { z } from 'zod';

export const deviceIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const identifier = z.string().min(1).max(128);
const natural = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const base = { schemaVersion: z.literal(1), deviceId: deviceIdSchema };

export const stateSchema = z
  .object({
    ...base,
    bootId: identifier,
    sequence: natural,
    uptimeMs: natural,
    generatedAt: z.iso.datetime({ offset: true }).optional(),
    sensor: z.object({
      ativo: z.boolean().nullable(),
      nivel: z.enum(['com_agua', 'sem_agua', 'desconhecido']),
    }),
    bomba: z.object({ status: z.enum(['ligada', 'desligada', 'desconhecido']) }),
    enchimento: z.object({
      status: z.enum(['parado', 'enchendo', 'concluido', 'falha', 'desconhecido']),
      cicloId: identifier.nullable(),
      origem: z.enum(['automatico', 'manual']).nullable(),
      commandId: z.uuid().nullable(),
      // O firmware pode não disponibilizar temporização; zero também representa configuração inválida.
      duracaoConfiguradaSegundos: natural.nullable().optional(),
      tempoRestanteSegundos: natural.nullable().optional(),
    }),
    falha: z.object({ codigo: identifier, mensagem: z.string().max(500) }).nullable(),
  })
  .superRefine((state, ctx) => {
    const expected =
      state.sensor.ativo === null ? 'desconhecido' : state.sensor.ativo ? 'com_agua' : 'sem_agua';
    if (state.sensor.nivel !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['sensor'],
        message: 'Nível incompatível com a leitura do sensor.',
      });
    }
  });

export const availabilitySchema = z.object({
  ...base,
  bootId: identifier,
  status: z.enum(['online', 'offline']),
});
export const commandSchema = z.object({
  ...base,
  commandId: z.uuid(),
  targetBootId: identifier,
  tipo: z.literal('encher'),
});
const responseBase = {
  ...base,
  bootId: identifier,
  commandId: z.uuid(),
  generatedAt: z.iso.datetime({ offset: true }).optional(),
};
export const responseSchema = z.discriminatedUnion('status', [
  z.object({ ...responseBase, status: z.literal('aceito'), cicloId: identifier }),
  z.object({
    ...responseBase,
    status: z.literal('rejeitado'),
    motivo: identifier,
    mensagem: z.string().max(500).optional(),
  }),
]);

export type DeviceState = z.infer<typeof stateSchema>;
export type Availability = z.infer<typeof availabilitySchema>;
export type FillCommand = z.infer<typeof commandSchema>;
export type CommandResponse = z.infer<typeof responseSchema>;
export type CommandStatus = 'pendente' | 'aceito' | 'rejeitado' | 'sem_resposta' | 'falha_envio';
export interface CommandView {
  commandId: string;
  status: CommandStatus;
  requestedAt: string;
  respondedAt: string | null;
  response: CommandResponse | null;
}
export interface Dashboard {
  deviceId: string;
  brokerConnected: boolean;
  availability: { status: 'online' | 'offline'; receivedAt: string; retained: boolean } | null;
  state: DeviceState | null;
  receivedAt: string | null;
  retained: boolean;
  lastCommand: CommandView | null;
}
export interface Session {
  user: { id: string; email: string };
  expiresAt: string;
}

export function topics(deviceId: string) {
  const prefix = `iot/v1/dispositivos/${deviceId}`;
  return {
    state: `${prefix}/estado`,
    availability: `${prefix}/disponibilidade`,
    commands: `${prefix}/comandos`,
    responses: `${prefix}/respostas`,
  };
}

export function shouldApplyState(current: DeviceState | null, next: DeviceState, retained: boolean) {
  if (!current) return true;
  if (current.bootId === next.bootId) return next.sequence > current.sequence;
  return !retained;
}
