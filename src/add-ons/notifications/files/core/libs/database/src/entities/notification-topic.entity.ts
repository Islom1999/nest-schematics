import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { User } from './user.entity';

/**
 * One user's subscription to a notification topic (`target: 'topic'` of an
 * admin broadcast goes to every subscriber). Unsubscribing deletes the row.
 * Deleting the user deletes their subscriptions. Schema: migration
 * `*-notifications-topics-schedule.ts`; keep both in sync.
 */
@Entity({ name: 'notification_topics' })
@Index('UQ_notification_topics_user_id_topic', ['userId', 'topic'], { unique: true })
@Index('IDX_notification_topics_topic', ['topic'])
export class NotificationTopic extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_notification_topics_user_id' })
  user?: User;

  @ApiProperty({ type: String, example: 'news', description: 'FCM-style topic name: letters, digits and - _ . ~ %' })
  @Column({ type: 'varchar', length: 100 })
  topic: string;
}
