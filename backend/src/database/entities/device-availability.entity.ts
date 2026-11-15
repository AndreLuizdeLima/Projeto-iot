import type { Availability } from '@iot/contracts';
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('device_availability')
export class DeviceAvailabilityEntity {
  @PrimaryColumn({ name: 'device_id', type: 'text' }) deviceId!: string;
  @Column('jsonb') payload!: Availability;
  @Column({ name: 'received_at', type: 'timestamptz' }) receivedAt!: Date;
  @Column('boolean') retained!: boolean;
}
