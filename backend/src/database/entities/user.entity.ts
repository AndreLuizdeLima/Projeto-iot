import { Check, Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('users')
@Check('users_email_check', 'email = lower(email)')
export class UserEntity {
  @PrimaryColumn('uuid') id!: string;
  @Column({ type: 'text', unique: true }) email!: string;
  @Column({ name: 'password_hash', type: 'text', select: false }) passwordHash!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
