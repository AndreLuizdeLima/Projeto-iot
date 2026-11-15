import type { CommandResponse, CommandStatus } from '@iot/contracts';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

@Entity('commands')
@Index('commands_device_time', ['deviceId', 'requestedAt'])
@Check('commands_status_check', "status IN ('pendente','aceito','rejeitado','sem_resposta','falha_envio')")
export class CommandEntity {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;
  @Column({ name: 'device_id', type: 'text' }) deviceId!: string;
  @Column({ name: 'target_boot_id', type: 'text' }) targetBootId!: string;
  @CreateDateColumn({ name: 'requested_at', type: 'timestamptz' }) requestedAt!: Date;
  @Column({ name: 'deadline_at', type: 'timestamptz' }) deadlineAt!: Date;
  @Column('text') status!: CommandStatus;
  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true }) respondedAt!: Date | null;
  @Column({ type: 'jsonb', nullable: true }) response!: CommandResponse | null;
}
