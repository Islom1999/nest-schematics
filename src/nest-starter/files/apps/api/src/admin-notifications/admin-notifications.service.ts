import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AdminNotification } from '@app/database';
import { AdminNotificationDto } from './admin-notifications.dto';

/** Most notifications `GET admin/me/notifications` returns (newest first). */
export const ADMIN_NOTIFICATIONS_LIMIT = 50;

export interface NewAdminNotification {
  title: string;
  description?: string;
  icon?: string;
  link?: string;
}

/**
 * The admin's own notifications (`admin_notifications`). Other features call
 * `notify(adminId, { title, link })`; an admin only ever reads and marks their own.
 */
@Injectable()
export class AdminNotificationsService {
  constructor(@InjectRepository(AdminNotification) private readonly repository: Repository<AdminNotification>) {}

  async notify(adminId: string, input: NewAdminNotification): Promise<void> {
    await this.repository.insert({
      adminId,
      title: input.title.slice(0, 200),
      description: input.description ?? null,
      icon: input.icon ?? null,
      link: input.link ?? null,
    });
  }

  async list(adminId: string): Promise<AdminNotificationDto[]> {
    const rows = await this.repository.find({
      where: { adminId },
      order: { createdAt: 'DESC' },
      take: ADMIN_NOTIFICATIONS_LIMIT,
    });
    return rows.map(toDto);
  }

  /** Marks one of the admin's notifications as read (again is fine); 404 for someone else's. */
  async markRead(adminId: string, id: string): Promise<AdminNotificationDto> {
    await this.repository.update({ id, adminId, readAt: IsNull() }, { readAt: new Date() });
    const row = await this.repository.findOne({ where: { id, adminId } });
    if (!row) throw new NotFoundException('Notification not found');
    return toDto(row);
  }
}

function toDto(row: AdminNotification): AdminNotificationDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    icon: row.icon,
    link: row.link,
    time: row.createdAt,
    read: row.readAt !== null,
  };
}
