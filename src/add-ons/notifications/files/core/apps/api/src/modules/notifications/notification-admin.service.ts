import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PaginatedResult, runTableQuery, TableQueryDto } from '@app/common';
import { NotificationService } from '@app/common/notifications';
import {
  Notification,
  NotificationCampaign,
  NotificationCampaignStatus,
  NotificationPushStatus,
  NotificationTarget,
} from '@app/database';
import { BroadcastNotificationDto, NotificationCampaignDetailDto, NotificationTableQueryDto } from './dto/notification.dto';

/** Admin side (`admin/notifications`): broadcasts, campaign history, every notification. */
@Injectable()
export class NotificationAdminService {
  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationCampaign) private readonly campaigns: Repository<NotificationCampaign>,
    private readonly sender: NotificationService,
  ) {}

  /**
   * Saves the campaign, then a notification per recipient, pushes them and
   * stores the totals (`sentCount` = notifications created, `failedCount` =
   * pushes that failed on the first attempt). With the queue add-on a
   * broadcast to everyone or to a topic is a job, so the totals arrive when it
   * finishes. With `sendAt` it only saves the campaign (status `scheduled`):
   * a delayed job (queue) or the worker's cron job sends it then.
   */
  async broadcast(dto: BroadcastNotificationDto, adminId: string | null): Promise<NotificationCampaign> {
    const sendAt = dto.sendAt ? new Date(dto.sendAt) : null;
    if (sendAt && sendAt.getTime() <= Date.now()) throw new BadRequestException('sendAt must be in the future');
    const filters =
      dto.target === NotificationTarget.USERS
        ? { userIds: [...new Set(dto.userIds ?? [])] }
        : dto.target === NotificationTarget.PLATFORM
          ? { platform: dto.platform }
          : dto.target === NotificationTarget.TOPIC
            ? { topic: dto.topic }
            : null;
    const campaign = await this.campaigns.save(
      this.campaigns.create({
        target: dto.target,
        filters,
        type: dto.type || 'general',
        title: dto.title,
        body: dto.body ?? '',
        link: dto.link || null,
        image: dto.image || null,
        meta: dto.meta ?? null,
        status: sendAt ? NotificationCampaignStatus.SCHEDULED : NotificationCampaignStatus.SENT,
        sendAt,
        createdById: adminId,
      }),
    );
    if (sendAt) {
      try {
        await this.sender.schedule(campaign);
      } catch (error) {
        // Nothing would ever send it: do not leave a campaign that looks scheduled.
        await this.campaigns.softDelete(campaign.id);
        throw new ServiceUnavailableException(`Could not schedule the campaign: ${(error as Error).message}`);
      }
      return campaign;
    }
    const result = await this.sender.sendCampaign(campaign);
    // A queued broadcast (queue add-on) stores its own totals when the job is done.
    if (!result.queued) {
      campaign.sentCount = result.created;
      campaign.failedCount = result.pushFailed;
    }
    return campaign;
  }

  /** Delivers one notification again (push and extra channels); it becomes unread and pending first. */
  async resend(id: string): Promise<Notification> {
    if (!(await this.sender.resend(id))) throw new NotFoundException('Notification not found');
    return this.notifications.findOneOrFail({ where: { id } });
  }

  /** Soft delete: the notification disappears from the user's inbox and the admin table. */
  async remove(id: string): Promise<void> {
    const result = await this.notifications.softDelete({ id, deletedAt: IsNull() });
    if (!result.affected) throw new NotFoundException('Notification not found');
  }

  /** Soft delete of a campaign that is still `scheduled`, so it never goes out. */
  async cancelCampaign(id: string): Promise<void> {
    const result = await this.campaigns.softDelete({ id, status: NotificationCampaignStatus.SCHEDULED, deletedAt: IsNull() });
    if (result.affected) return;
    if (!(await this.campaigns.exists({ where: { id } }))) throw new NotFoundException('Campaign not found');
    throw new ConflictException('Only a scheduled campaign can be cancelled');
  }

  campaignsPage(query: TableQueryDto): Promise<PaginatedResult<NotificationCampaign>> {
    return runTableQuery(this.campaigns.createQueryBuilder('campaign'), query, {
      searchFields: ['title', 'body', 'type'],
      defaultSort: { field: 'createdAt', order: 'DESC' },
    });
  }

  async campaign(id: string): Promise<NotificationCampaignDetailDto> {
    const campaign = await this.campaigns.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    const rows = await this.notifications
      .createQueryBuilder('n')
      .select('n.pushStatus', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COUNT(n.readAt)', 'read')
      .where('n.campaignId = :id', { id })
      .groupBy('n.pushStatus')
      .getRawMany<{ status: NotificationPushStatus; count: string; read: string }>();
    const by = (status: NotificationPushStatus) => Number(rows.find((r) => r.status === status)?.count ?? 0);
    return {
      campaign,
      stats: {
        total: rows.reduce((sum, r) => sum + Number(r.count), 0),
        read: rows.reduce((sum, r) => sum + Number(r.read), 0),
        pushPending: by(NotificationPushStatus.PENDING),
        pushSent: by(NotificationPushStatus.SENT),
        pushFailed: by(NotificationPushStatus.FAILED),
        pushSkipped: by(NotificationPushStatus.SKIPPED),
      },
    };
  }

  notificationsPage(query: NotificationTableQueryDto): Promise<PaginatedResult<Notification>> {
    return runTableQuery(this.notifications.createQueryBuilder('notification'), query, {
      searchFields: ['title', 'body', 'type'],
      defaultSort: { field: 'createdAt', order: 'DESC' },
      queryFilters: ['userId'],
    });
  }
}
