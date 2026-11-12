import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { PaginatedResult } from '@app/common';
import { Notification, NotificationTopic } from '@app/database';
import { NotificationListQueryDto, NotificationTopicDto, TOPIC_RE } from './dto/notification.dto';

/** Topics one user can be subscribed to at a time. */
const MAX_TOPICS = 100;

/** The signed-in user's own notifications and topic subscriptions (`client/notifications`). */
@Injectable()
export class NotificationInboxService {
  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationTopic) private readonly topics: Repository<NotificationTopic>,
  ) {}

  async list(userId: string, query: NotificationListQueryDto): Promise<PaginatedResult<Notification>> {
    const where: FindOptionsWhere<Notification> = { userId, ...(query.unread ? { readAt: IsNull() } : {}) };
    const [data, count] = await this.notifications.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: query.first ?? 0,
      take: query.rows ?? 20,
    });
    return { count, data };
  }

  unreadCount(userId: string): Promise<number> {
    return this.notifications.count({ where: { userId, readAt: IsNull() } });
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const notification = await this.notifications.findOne({ where: { id, userId } });
    if (!notification) throw new NotFoundException('Notification not found');
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notifications.update({ id, userId }, { readAt: notification.readAt });
    }
    return notification;
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.notifications.update({ userId, readAt: IsNull() }, { readAt: new Date() });
    return result.affected ?? 0;
  }

  async topicsOf(userId: string): Promise<NotificationTopicDto[]> {
    const rows = await this.topics.find({ where: { userId }, order: { topic: 'ASC' } });
    return rows.map((r) => ({ topic: r.topic, subscribedAt: r.createdAt }));
  }

  /** Subscribes the user to a topic (again is fine: it keeps the first subscription time). */
  async subscribe(userId: string, topic: string): Promise<NotificationTopicDto> {
    if (!TOPIC_RE.test(topic)) throw new BadRequestException('A topic is 1 to 100 letters, digits or - _ . ~ %');
    const existing = await this.topics.findOne({ where: { userId, topic } });
    if (existing) return { topic, subscribedAt: existing.createdAt };
    if ((await this.topics.count({ where: { userId } })) >= MAX_TOPICS) {
      throw new BadRequestException(`At most ${MAX_TOPICS} topics per user`);
    }
    // Two parallel calls: the unique (user_id, topic) index keeps one row.
    await this.topics.createQueryBuilder().insert().values({ userId, topic }).orIgnore().execute();
    const row = await this.topics.findOneOrFail({ where: { userId, topic } });
    return { topic, subscribedAt: row.createdAt };
  }

  /** Unsubscribes (hard delete); a topic the user was not on is fine. */
  async unsubscribe(userId: string, topic: string): Promise<void> {
    await this.topics.delete({ userId, topic });
  }
}
