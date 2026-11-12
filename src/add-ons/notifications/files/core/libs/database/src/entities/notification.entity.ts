import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { NotificationCampaign } from './notification-campaign.entity';
import { User } from './user.entity';

/** Push delivery state of one notification. */
export enum NotificationPushStatus {
  /** Saved, push not attempted yet. */
  PENDING = 'pending',
  /** At least one device of the user accepted it. */
  SENT = 'sent',
  /** Every attempt failed; the worker retries up to NOTIFICATION_PUSH_MAX_ATTEMPTS. */
  FAILED = 'failed',
  /** Not pushed: push is off (no FIREBASE_SERVICE_ACCOUNT_JSON) or the user has no device. */
  SKIPPED = 'skipped',
}

/**
 * One in-app notification of a user (`npm run g -- notifications`). It is
 * saved first, then pushed to the user's signed-in devices (push tokens live on
 * `user_sessions`). Deleting the user deletes their notifications.
 * Schema: migration `*-notifications.ts`; keep both in sync.
 */
@Entity({ name: 'notifications' })
@Index('IDX_notifications_user_id_read_at', ['userId', 'readAt'])
@Index('IDX_notifications_user_id_created_at', ['userId', 'createdAt'])
@Index('IDX_notifications_campaign_id', ['campaignId'])
@Index('IDX_notifications_push_status', ['pushStatus'])
export class Notification extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_notifications_user_id' })
  user?: User;

  @ApiProperty({ type: String, example: 'order', description: 'Free-form kind the app can switch on (order, promo, general...)' })
  @Column({ type: 'varchar', length: 50, default: 'general' })
  type: string;

  @ApiProperty({ type: String, example: 'Your order has shipped' })
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @ApiProperty({ type: String, example: 'Order #1024 is on its way.' })
  @Column({ type: 'text', default: '' })
  body: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '/orders/1024', description: 'Where the app opens on tap' })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  link: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Image URL (shown in the push too when it is http(s))' })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  image: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: 'Extra data for the app' })
  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Admin broadcast it belongs to' })
  @Column({ type: 'uuid', nullable: true })
  campaignId: string | null;

  @ManyToOne(() => NotificationCampaign, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'campaign_id', foreignKeyConstraintName: 'FK_notifications_campaign_id' })
  campaign?: NotificationCampaign | null;

  @ApiProperty({ enum: NotificationPushStatus, enumName: 'NotificationPushStatus' })
  @Column({ type: 'varchar', length: 16, default: NotificationPushStatus.PENDING })
  pushStatus: NotificationPushStatus;

  @ApiProperty({ type: Number, description: 'Push attempts so far' })
  @Column({ type: 'int', default: 0 })
  pushAttempts: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Last push error' })
  @Column({ type: 'varchar', length: 500, nullable: true })
  pushError: string | null;
}
