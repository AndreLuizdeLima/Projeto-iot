import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('mqtt_messages')
@Index('mqtt_messages_device_time', ['deviceId', 'observedAt'])
@Check('mqtt_messages_direction_check', "direction IN ('recebida', 'enviada')")
export class MqttMessageEntity {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' }) id!: string;
  @Column({ name: 'device_id', type: 'text', nullable: true }) deviceId!: string | null;
  @Column('text') direction!: 'recebida' | 'enviada';
  @Column('text') topic!: string;
  @Column('text') payload!: string;
  @Column({ name: 'payload_base64', type: 'text', nullable: true }) payloadBase64!: string | null;
  @CreateDateColumn({ name: 'observed_at', type: 'timestamptz' }) observedAt!: Date;
  @Column('smallint') qos!: number;
  @Column({ default: false }) retained!: boolean;
  @Column('boolean') valid!: boolean;
  @Column({ name: 'validation_error', type: 'text', nullable: true }) validationError!: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) metadata!: Record<string, unknown>;
  @Column({ name: 'delivery_status', type: 'text', nullable: true }) deliveryStatus!:
    'pendente' | 'publicada' | 'falha' | null;
  @Column({ name: 'delivery_error', type: 'text', nullable: true }) deliveryError!: string | null;
}
