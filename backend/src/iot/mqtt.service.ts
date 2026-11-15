import { Inject, Injectable, Logger, OnModuleDestroy, OnApplicationBootstrap } from '@nestjs/common';
import {
  availabilitySchema,
  commandSchema,
  FillCommand,
  responseSchema,
  stateSchema,
  topics,
} from '@iot/contracts';
import { connect, MqttClient } from 'mqtt';
import { CONFIG, Config } from '../config';
import { EventsService } from './events.service';
import { Incoming, IotRepository } from './iot.repository';
import { randomUUID } from 'node:crypto';

@Injectable()
export class MqttService implements OnApplicationBootstrap, OnModuleDestroy {
  private client?: MqttClient;
  private readonly logger = new Logger(MqttService.name);
  private stopping = false;
  connected = false;
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly repository: IotRepository,
    private readonly events: EventsService,
  ) {}
  onApplicationBootstrap() {
    const channel = topics(this.config.IOT_DEVICE_ID);
    this.client = connect(this.config.MQTT_URL, {
      username: this.config.MQTT_USERNAME,
      password: this.config.MQTT_PASSWORD,
      clientId: `backend-status-${this.config.IOT_DEVICE_ID}`,
      clean: true,
      protocolVersion: 5,
      reconnectPeriod: 3000,
      connectTimeout: 5000,
      queueQoSZero: false,
      properties: { maximumPacketSize: 65536 },
    });
    this.client.on('connect', () => {
      this.client!.subscribe(
        [channel.state, channel.availability, channel.responses],
        { qos: 1 },
        (error) => {
          this.connected = !error;
          this.events.notify(this.config.IOT_DEVICE_ID);
          if (error) this.logger.error('Não foi possível assinar os tópicos MQTT.');
        },
      );
    });
    this.client.on('close', () => {
      this.connected = false;
      this.events.notify(this.config.IOT_DEVICE_ID);
    });
    this.client.on('error', () =>
      this.logger.warn('Conexão MQTT indisponível; confira endereço, credenciais e ACLs.'),
    );
    // Processa e persiste cada pacote antes de liberar o próximo na sessão.
    this.client.handleMessage = (packet, done) => {
      this.ingest(
        packet.topic,
        Buffer.isBuffer(packet.payload) ? packet.payload : Buffer.from(packet.payload),
        packet.qos,
        packet.retain,
      ).then(
        () => done(),
        (error) => {
          this.logger.error('Falha ao persistir mensagem MQTT. A sessão será reconectada.');
          this.connected = false;
          done(error instanceof Error ? error : new Error('Falha de persistência.'));
          if (!this.stopping) this.client?.reconnect();
        },
      );
    };
  }
  async ingest(topic: string, payload: Buffer, qos: number, retained: boolean) {
    const channel = topics(this.config.IOT_DEVICE_ID);
    const kind: Incoming['kind'] =
      topic === channel.state
        ? 'state'
        : topic === channel.availability
          ? 'availability'
          : topic === channel.responses
            ? 'response'
            : 'unknown';
    let value: Incoming['value'];
    let error: string | undefined;
    try {
      if (payload.length > 65536) throw new Error('Payload acima de 64 KiB.');
      const schema =
        kind === 'state'
          ? stateSchema
          : kind === 'availability'
            ? availabilitySchema
            : kind === 'response'
              ? responseSchema
              : null;
      if (!schema) throw new Error('Tópico desconhecido.');
      const parsed = schema.safeParse(JSON.parse(payload.toString('utf8')));
      if (!parsed.success)
        throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      if (parsed.data.deviceId !== this.config.IOT_DEVICE_ID)
        throw new Error('Dispositivo não corresponde ao tópico.');
      value = parsed.data;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Mensagem inválida.';
    }
    const changed = await this.repository.receive({ topic, payload, qos, retained, kind, value, error });
    if (changed) this.events.notify(this.config.IOT_DEVICE_ID);
  }
  async publishCommand(command: FillCommand) {
    commandSchema.parse(command);
    // Uma sessão curta, sem reconexão, evita deixar comandos em fila entre conexões.
    const publisher = connect(this.config.MQTT_URL, {
      username: this.config.MQTT_USERNAME,
      password: this.config.MQTT_PASSWORD,
      clientId: `backend-command-${randomUUID()}`,
      protocolVersion: 5,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: 4000,
      queueQoSZero: false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Prazo de publicação esgotado.')), 5000);
        const finish = (error?: Error | null) => {
          clearTimeout(timeout);
          error ? reject(error) : resolve();
        };
        publisher.once('error', finish);
        publisher.once('close', () => finish(new Error('Conexão de publicação encerrada.')));
        publisher.once('connect', () =>
          publisher.publish(
            topics(command.deviceId).commands,
            JSON.stringify(command),
            {
              qos: 1,
              retain: false,
              properties: { messageExpiryInterval: 5 },
            },
            finish,
          ),
        );
      });
    } finally {
      await publisher.endAsync(true);
    }
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.client) await this.client.endAsync(true);
  }
}
