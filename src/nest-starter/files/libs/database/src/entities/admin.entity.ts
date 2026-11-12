import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { AdminRole } from './admin-role.entity';

/** Emails are stored trimmed and lowercased, so the unique index is case-insensitive. */
export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const lowercase = {
  to: (value?: string | null) => (typeof value === 'string' ? normalizeEmail(value) : value),
  from: (value: string) => value,
};

/** Admin panel account. `passwordHash` (argon2id) is never selected by default. */
@Entity('admins')
@Index('UQ_admins_email', ['email'], { unique: true, where: 'deleted_at IS NULL' })
export class Admin extends BaseEntity {
  @ApiProperty({ example: 'admin@example.com' })
  @Column({ type: 'varchar', length: 254, transformer: lowercase })
  email: string;

  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @ApiProperty({ example: 'Admin' })
  @Column({ type: 'varchar', length: 120, default: '' })
  name: string;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  isBlocked: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @Index('IDX_admins_role_id')
  @Column({ type: 'uuid', nullable: true })
  roleId: string | null;

  @ApiPropertyOptional({ type: () => AdminRole, nullable: true })
  @ManyToOne(() => AdminRole, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'role_id', foreignKeyConstraintName: 'FK_admins_role_id' })
  role?: AdminRole | null;
}
