import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Admin } from './admin.entity';
import { AuthSessionBase } from './auth-session.base';

/** One signed-in admin device. Hard-deleting the admin deletes its sessions. */
@Entity('admin_sessions')
@Index('UQ_admin_sessions_refresh_hash', ['refreshHash'], { unique: true })
@Index('IDX_admin_sessions_admin_id', ['adminId'])
export class AdminSession extends AuthSessionBase {
  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  adminId: string;

  @ManyToOne(() => Admin, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'admin_id', foreignKeyConstraintName: 'FK_admin_sessions_admin_id' })
  admin?: Admin;
}
