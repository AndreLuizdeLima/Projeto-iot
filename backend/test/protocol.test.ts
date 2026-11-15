import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  commandSchema,
  responseSchema,
  shouldApplyState,
  stateSchema,
  type DeviceState,
} from '@iot/contracts';

const state: DeviceState = {
  schemaVersion: 1,
  deviceId: 'caixa-001',
  bootId: 'boot-a',
  sequence: 1,
  uptimeMs: 0,
  sensor: { ativo: false, nivel: 'sem_agua' },
  bomba: { status: 'desligada' },
  enchimento: { status: 'parado', cicloId: null, commandId: null, origem: null },
  falha: null,
};
test('aceita estado sem temporização e exige consistência apenas na representação do sensor', () => {
  assert.equal(stateSchema.safeParse(state).success, true);
  assert.equal(
    stateSchema.safeParse({ ...state, sensor: { ativo: true, nivel: 'sem_agua' } }).success,
    false,
  );
  assert.equal(
    stateSchema.safeParse({
      ...state,
      sensor: { ativo: null, nivel: 'desconhecido' },
      enchimento: { ...state.enchimento, status: 'desconhecido' },
    }).success,
    true,
  );
});
test('representa falha de tempo sem impedir comunicação da configuração inválida', () => {
  assert.equal(
    stateSchema.safeParse({
      ...state,
      enchimento: { ...state.enchimento, status: 'falha', duracaoConfiguradaSegundos: 0 },
      falha: { codigo: 'TEMPO_ENCHIMENTO_INVALIDO', mensagem: 'Configuração inválida.' },
    }).success,
    true,
  );
});
test('ignora estado duplicado e retido de outro boot sem perder atualização nova', () => {
  assert.equal(shouldApplyState(state, state, false), false);
  assert.equal(shouldApplyState(state, { ...state, sequence: 0 }, false), false);
  assert.equal(shouldApplyState(state, { ...state, sequence: 2 }, true), true);
  assert.equal(shouldApplyState(state, { ...state, bootId: 'boot-b' }, true), false);
  assert.equal(shouldApplyState(state, { ...state, bootId: 'boot-b', sequence: 0 }, false), true);
});
test('contrato correlaciona comandos e aceita motivos de rejeição definidos pelo IoT', () => {
  const commandId = randomUUID();
  assert.equal(
    commandSchema.safeParse({
      schemaVersion: 1,
      deviceId: state.deviceId,
      commandId,
      targetBootId: state.bootId,
      tipo: 'encher',
    }).success,
    true,
  );
  assert.equal(
    responseSchema.safeParse({
      schemaVersion: 1,
      deviceId: state.deviceId,
      bootId: state.bootId,
      commandId,
      status: 'rejeitado',
      motivo: 'PROTECAO_LOCAL_ATIVA',
    }).success,
    true,
  );
  assert.equal(
    responseSchema.safeParse({
      schemaVersion: 1,
      deviceId: state.deviceId,
      bootId: state.bootId,
      commandId,
      status: 'aceito',
    }).success,
    false,
  );
});
