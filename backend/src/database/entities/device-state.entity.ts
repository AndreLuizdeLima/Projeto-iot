import type { DeviceState } from '@iot/contracts';
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('device_state')
export class DeviceStateEntity {
  @PrimaryColumn({ name: 'device_id', type: 'text' }) deviceId!: string;
  @Column('jsonb') state!: DeviceState;
  @Column({ name: 'received_at', type: 'timestamptz' }) receivedAt!: Date;
  @Column('boolean') retained!: boolean;
}
