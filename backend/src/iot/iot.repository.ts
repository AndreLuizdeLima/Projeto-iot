import { Inject, Injectable } from '@nestjs/common';
import {
  Availability,
  CommandResponse,
  CommandView,
  Dashboard,
  DeviceState,
  FillCommand,
  shouldApplyState,
  topics,
} from '@iot/contracts';
import { DataSource, In, LessThanOrEqual } from 'typeorm';
import { CONFIG, Config } from '../config';
import { CommandEntity } from '../database/entities/command.entity';
import { DeviceAvailabilityEntity } from '../database/entities/device-availability.entity';
import { DeviceStateEntity } from '../database/entities/device-state.entity';
import { MqttMessageEntity } from '../database/entities/mqtt-message.entity';

function commandView(command: CommandEntity): CommandView {
  return {
    commandId: command.id,
    status: command.status,
    requestedAt: command.requestedAt.toISOString(),
    respondedAt: command.respondedAt?.toISOString() ?? null,
    response: command.response,
  };
}

export interface Incoming {
  topic: string;
  payload: Buffer;
  qos: number;
  retained: boolean;
  kind: 'state' | 'availability' | 'response' | 'unknown';
  value?: DeviceState | Availability | CommandResponse;
  error?: string;
}

@Injectable()
export class IotRepository {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async receive(message: Incoming): Promise<boolean> {
    const { value } = message;
    return this.dataSource.transaction(async (manager) => {
      const receivedAt = new Date();
      const messages = manager.getRepository(MqttMessageEntity);
      await messages.save(
        messages.create({
          deviceId: value?.deviceId ?? null,
          direction: 'recebida',
          topic: message.topic,
          payload: message.payload.toString('utf8'),
          payloadBase64: message.payload.toString('base64'),
          observedAt: receivedAt,
          qos: message.qos,
          retained: message.retained,
          valid: !!value,
          validationError: message.error ?? null,
          metadata: value ? { ...value } : {},
        }),
      );
      if (!value) return false;
      if (message.kind === 'state') {
        const state = value as DeviceState;
        const states = manager.getRepository(DeviceStateEntity);
        const current = await states.findOne({
          where: { deviceId: state.deviceId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!shouldApplyState(current?.state ?? null, state, message.retained)) return false;
        await states.upsert({ deviceId: state.deviceId, state, receivedAt, retained: message.retained }, [
          'deviceId',
        ]);
        return true;
      }
      if (message.kind === 'availability') {
        const availability = value as Availability;
        await manager.getRepository(DeviceAvailabilityEntity).upsert(
          {
            deviceId: availability.deviceId,
            payload: availability,
            receivedAt,
            retained: message.retained,
          },
          ['deviceId'],
        );
        return true;
      }
      if (message.kind === 'response' && !message.retained) {
        const response = value as CommandResponse;
        const result = await manager.getRepository(CommandEntity).update(
          {
            id: response.commandId,
            deviceId: response.deviceId,
            targetBootId: response.bootId,
            status: In(['pendente', 'sem_resposta', 'falha_envio']),
          },
          { status: response.status, response, respondedAt: receivedAt },
        );
        return (result.affected ?? 0) > 0;
      }
      return false;
    });
  }

  async dashboard(brokerConnected: boolean): Promise<Dashboard> {
    const deviceId = this.config.IOT_DEVICE_ID;
    const [reading, presence, command] = await Promise.all([
      this.dataSource.getRepository(DeviceStateEntity).findOneBy({ deviceId }),
      this.dataSource.getRepository(DeviceAvailabilityEntity).findOneBy({ deviceId }),
      this.dataSource
        .getRepository(CommandEntity)
        .findOne({ where: { deviceId }, order: { requestedAt: 'DESC', id: 'DESC' } }),
    ]);
    return {
      deviceId,
      brokerConnected,
      state: reading?.state ?? null,
      receivedAt: reading?.receivedAt.toISOString() ?? null,
      retained: reading?.retained ?? false,
      availability: presence
        ? {
            status: presence.payload.status,
            receivedAt: presence.receivedAt.toISOString(),
            retained: presence.retained,
          }
        : null,
      lastCommand: command ? commandView(command) : null,
    };
  }

  async getCommand(id: string, userId: string) {
    const command = await this.dataSource.getRepository(CommandEntity).findOneBy({ id, userId });
    return command ? commandView(command) : null;
  }

  async getAvailability(deviceId: string) {
    return this.dataSource.getRepository(DeviceAvailabilityEntity).findOneBy({ deviceId });
  }

  async queueCommand(command: FillCommand, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const requestedAt = new Date();
      const insert = await manager
        .getRepository(CommandEntity)
        .createQueryBuilder()
        .insert()
        .values({
          id: command.commandId,
          userId,
          deviceId: command.deviceId,
          targetBootId: command.targetBootId,
          requestedAt,
          deadlineAt: new Date(requestedAt.getTime() + this.config.COMMAND_RESPONSE_TIMEOUT_SECONDS * 1000),
          status: 'pendente',
        })
        .orIgnore()
        .returning('id')
        .execute();
      if (!Array.isArray(insert.raw) || !insert.raw.length) return null;
      const messages = manager.getRepository(MqttMessageEntity);
      const message = await messages.save(
        messages.create({
          deviceId: command.deviceId,
          direction: 'enviada',
          topic: topics(command.deviceId).commands,
          payload: JSON.stringify(command),
          qos: 1,
          retained: false,
          valid: true,
          metadata: { ...command },
          deliveryStatus: 'pendente',
        }),
      );
      return message.id;
    });
  }

  async markPublished(messageId: string) {
    await this.dataSource.getRepository(MqttMessageEntity).update(messageId, { deliveryStatus: 'publicada' });
  }

  async markPublishFailed(messageId: string, commandId: string) {
    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(MqttMessageEntity)
        .update(messageId, { deliveryStatus: 'falha', deliveryError: 'Publicação não confirmada.' });
      await manager
        .getRepository(CommandEntity)
        .update({ id: commandId, status: 'pendente' }, { status: 'falha_envio' });
    });
  }

  async expireCommands() {
    const result = await this.dataSource.getRepository(CommandEntity).update(
      {
        status: 'pendente',
        deadlineAt: LessThanOrEqual(new Date()),
      },
      { status: 'sem_resposta' },
    );
    return (result.affected ?? 0) > 0;
  }
}
