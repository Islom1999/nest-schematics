import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaginatedResult, runTableQuery, TableQueryDto } from '@app/common';
import { NotificationService } from '@app/common/notifications';
import { Notification, NotificationCampaign, NotificationPushStatus, NotificationTarget } from '@app/database';
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
   * pushes that failed on the first attempt).
   */
  async broadcast(dto: BroadcastNotificationDto, adminId: string | null): Promise<NotificationCampaign> {
    const filters =
      dto.target === NotificationTarget.USERS
        ? { userIds: [...new Set(dto.userIds ?? [])] }
        : dto.target === NotificationTarget.PLATFORM
          ? { platform: dto.platform }
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
        createdById: adminId,
      }),
    );
    const result = await this.sender.send(
      dto.target === NotificationTarget.USERS ? (filters?.userIds ?? []) : 'all',
      { type: campaign.type, title: dto.title, body: dto.body, link: dto.link, image: dto.image, meta: dto.meta },
      { campaignId: campaign.id, platform: dto.target === NotificationTarget.PLATFORM ? (dto.platform ?? null) : null },
    );
    campaign.sentCount = result.created;
    campaign.failedCount = result.pushFailed;
    await this.campaigns.update(campaign.id, { sentCount: campaign.sentCount, failedCount: campaign.failedCount });
    return campaign;
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
