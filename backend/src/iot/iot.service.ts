import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FillCommand } from '@iot/contracts';
import { CONFIG, Config } from '../config';
import { EventsService } from './events.service';
import { IotRepository } from './iot.repository';
import { MqttService } from './mqtt.service';

@Injectable()
export class IotService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(IotService.name);
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly mqtt: MqttService,
    private readonly repository: IotRepository,
    private readonly events: EventsService,
  ) {}
  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      this.repository
        .expireCommands()
        .then((changed) => {
          if (changed) this.events.notify(this.config.IOT_DEVICE_ID);
        })
        .catch(() => this.logger.error('Falha ao atualizar solicitações sem resposta.'));
    }, 1000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  dashboard() {
    return this.repository.dashboard(this.mqtt.connected);
  }
  async fill(deviceId: string, userId: string, commandId: string) {
    if (deviceId !== this.config.IOT_DEVICE_ID) throw new NotFoundException('Dispositivo não encontrado.');
    const existing = await this.repository.getCommand(commandId, userId);
    if (existing) return existing;
    if (!this.mqtt.connected) throw new ServiceUnavailableException('Broker MQTT desconectado.');
    const availability = await this.repository.getAvailability(deviceId);
    const presence = availability?.payload;
    if (!presence || presence.status !== 'online')
      throw new ConflictException('O dispositivo ainda não informou disponibilidade online.');
    // Não há decisão sobre nível, bomba ou idade da leitura aqui: cabe ao IoT aceitar/rejeitar.
    const command: FillCommand = {
      schemaVersion: 1,
      deviceId,
      commandId,
      targetBootId: presence.bootId,
      tipo: 'encher',
    };
    const queued = await this.repository.queueCommand(command, userId);
    if (queued) {
      this.events.notify(deviceId);
      try {
        await this.mqtt.publishCommand(command);
        await this.repository.markPublished(queued);
      } catch {
        await this.repository.markPublishFailed(queued, commandId);
      }
      this.events.notify(deviceId);
    }
    const result = await this.repository.getCommand(commandId, userId);
    if (!result) throw new ConflictException('Identificador da solicitação já utilizado.');
    return result;
  }
}
