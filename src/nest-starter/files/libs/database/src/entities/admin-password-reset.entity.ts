import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { Admin } from './admin.entity';

/**
 * A password-reset token of an admin. Only the sha256 of the token is stored;
 * the token itself exists in the email only. Single use (`usedAt`) and short
 * lived (`expiresAt`). Hard-deleting the admin deletes its tokens.
 */
@Entity('admin_password_resets')
@Index('UQ_admin_password_resets_token_hash', ['tokenHash'], { unique: true })
@Index('IDX_admin_password_resets_admin_id', ['adminId'])
export class AdminPasswordReset extends BaseEntity {
  @Column({ type: 'uuid' })
  adminId: string;

  @Column({ type: 'varchar', length: 64, select: false })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @ManyToOne(() => Admin, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'admin_id', foreignKeyConstraintName: 'FK_admin_password_resets_admin_id' })
  admin?: Admin;
}
