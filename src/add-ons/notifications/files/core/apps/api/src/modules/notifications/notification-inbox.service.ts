import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { PaginatedResult } from '@app/common';
import { Notification } from '@app/database';
import { NotificationListQueryDto } from './dto/notification.dto';

/** The signed-in user's own notifications (`client/notifications`). */
@Injectable()
export class NotificationInboxService {
  constructor(@InjectRepository(Notification) private readonly notifications: Repository<Notification>) {}

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
}
