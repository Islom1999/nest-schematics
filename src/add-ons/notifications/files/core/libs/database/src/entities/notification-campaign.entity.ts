import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/** Who an admin broadcast goes to. */
export enum NotificationTarget {
  ALL = 'all',
  USERS = 'users',
  PLATFORM = 'platform',
  /** Users subscribed to a topic (`notification_topics`). */
  TOPIC = 'topic',
}

/** Where a campaign is on its way to the users. */
export enum NotificationCampaignStatus {
  /** Waits for `sendAt` (the queue's delayed job or the worker cron picks it up). */
  SCHEDULED = 'scheduled',
  /** Being sent right now. */
  SENDING = 'sending',
  /** Handed to its recipients (the default; also every campaign sent at once). */
  SENT = 'sent',
  /** The scheduled send threw; the rows it saved before that are kept, it is not retried. */
  FAILED = 'failed',
}

/** `filters` of a campaign: the user ids (target `users`), the platform (`platform`) or the topic (`topic`). */
export interface NotificationCampaignFilters {
  userIds?: string[];
  platform?: string;
  topic?: string;
}

/**
 * One admin broadcast (`POST admin/notifications/broadcast`). Every recipient
 * gets a `notifications` row with this `campaignId`, so a campaign's reads and
 * push results can be counted later. Schema: migration `*-notifications.ts`
 * (`npm run g -- notifications`); keep both in sync.
 */
@Entity({ name: 'notification_campaigns' })
@Index('IDX_notification_campaigns_status_send_at', ['status', 'sendAt'])
export class NotificationCampaign extends BaseEntity {
  @ApiProperty({ enum: NotificationTarget, enumName: 'NotificationTarget' })
  @Column({ type: 'varchar', length: 16 })
  target: NotificationTarget;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { platform: 'android' },
    description: '{ userIds } for target users, { platform } for target platform, { topic } for target topic',
  })
  @Column({ type: 'jsonb', nullable: true })
  filters: NotificationCampaignFilters | null;

  @ApiProperty({ type: String, example: 'promo' })
  @Column({ type: 'varchar', length: 50, default: 'general' })
  type: string;

  @ApiProperty({ type: String, example: 'Spring sale' })
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @ApiProperty({ type: String, example: 'Everything is 20% off until Sunday.' })
  @Column({ type: 'text', default: '' })
  body: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  link: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  image: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: 'Extra data for the app, copied to every notification' })
  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;

  @ApiProperty({ type: Number, description: 'Notifications created (one per recipient)' })
  @Column({ type: 'int', default: 0 })
  sentCount: number;

  @ApiProperty({ type: Number, description: 'Recipients whose push failed on the first attempt (the worker retries them)' })
  @Column({ type: 'int', default: 0 })
  failedCount: number;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Admin who sent it' })
  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @ApiProperty({ enum: NotificationCampaignStatus, enumName: 'NotificationCampaignStatus' })
  @Column({ type: 'varchar', length: 16, default: NotificationCampaignStatus.SENT })
  status: NotificationCampaignStatus;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'When a scheduled campaign goes out (null = it was sent at once)' })
  @Column({ type: 'timestamptz', nullable: true })
  sendAt: Date | null;
}
