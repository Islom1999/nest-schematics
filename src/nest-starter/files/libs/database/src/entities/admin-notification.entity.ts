import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { Admin } from './admin.entity';

/** A notification for one admin (the bell of the admin panel). `readAt` null = unread. */
@Entity('admin_notifications')
@Index('IDX_admin_notifications_admin_created', ['adminId', 'createdAt'])
export class AdminNotification extends BaseEntity {
  @Column({ type: 'uuid' })
  adminId: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Icon name of the UI, e.g. `heroicons_mini:star`. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  icon: string | null;

  /** Router link of the admin app. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  link: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @ManyToOne(() => Admin, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'admin_id', foreignKeyConstraintName: 'FK_admin_notifications_admin_id' })
  admin?: Admin;
}
