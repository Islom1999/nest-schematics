import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { NotificationService } from '@app/common/notifications';
import { Notification, NotificationCampaign, NotificationCampaignStatus, NotificationTarget } from '@app/database';
import { BroadcastNotificationDto } from './dto/notification.dto';
import { NotificationAdminService } from './notification-admin.service';

describe('NotificationAdminService', () => {
  const campaignSave = jest.fn(async (c: Partial<NotificationCampaign>) => ({ id: 'c1', sentCount: 0, failedCount: 0, ...c }));
  const campaignSoftDelete = jest.fn(async (..._args: unknown[]) => ({ affected: 1 }));
  const campaignExists = jest.fn(async (..._args: unknown[]) => true);
  const notificationSoftDelete = jest.fn(async (..._args: unknown[]) => ({ affected: 1 }));
  const sendCampaign = jest.fn(async (..._args: unknown[]) => ({ created: 3, pushSent: 1, pushFailed: 2, pushSkipped: 0 }));
  const schedule = jest.fn(async (..._args: unknown[]) => undefined);
  const resend = jest.fn(async (..._args: unknown[]) => true);
  const findOneOrFail = jest.fn(async (..._args: unknown[]) => ({ id: 'n1', pushStatus: 'skipped' }));

  function service(): NotificationAdminService {
    const campaigns = {
      create: (c: unknown) => c,
      save: campaignSave,
      softDelete: campaignSoftDelete,
      exists: campaignExists,
    } as unknown as Repository<NotificationCampaign>;
    const notifications = { softDelete: notificationSoftDelete, findOneOrFail } as unknown as Repository<Notification>;
    const sender = { sendCampaign, schedule, resend } as unknown as NotificationService;
    return new NotificationAdminService(notifications, campaigns, sender);
  }

  const dto = (extra: Partial<BroadcastNotificationDto> = {}): BroadcastNotificationDto =>
    Object.assign(new BroadcastNotificationDto(), { target: NotificationTarget.ALL, title: 'Hello', ...extra });

  beforeEach(() => {
    for (const fn of [campaignSave, campaignSoftDelete, campaignExists, notificationSoftDelete, sendCampaign, schedule, resend, findOneOrFail]) fn.mockClear();
  });

  it('sends a broadcast at once and returns the totals', async () => {
    const campaign = await service().broadcast(dto(), 'admin-1');
    expect(campaignSave.mock.calls[0][0]).toEqual(expect.objectContaining({ status: NotificationCampaignStatus.SENT, sendAt: null, createdById: 'admin-1' }));
    expect(sendCampaign).toHaveBeenCalledTimes(1);
    expect(schedule).not.toHaveBeenCalled();
    expect([campaign.sentCount, campaign.failedCount]).toEqual([3, 2]);
  });

  it('keeps the topic in the campaign filters', async () => {
    await service().broadcast(dto({ target: NotificationTarget.TOPIC, topic: 'news' }), null);
    expect(campaignSave.mock.calls[0][0]).toEqual(expect.objectContaining({ target: 'topic', filters: { topic: 'news' } }));
  });

  it('saves a campaign with sendAt as scheduled and sends nothing yet', async () => {
    const sendAt = new Date(Date.now() + 3600_000).toISOString();
    const campaign = await service().broadcast(dto({ sendAt }), null);
    expect(campaign.status).toBe(NotificationCampaignStatus.SCHEDULED);
    expect(campaign.sendAt).toEqual(new Date(sendAt));
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(sendCampaign).not.toHaveBeenCalled();
  });

  it('refuses a sendAt that is not in the future', async () => {
    await expect(service().broadcast(dto({ sendAt: new Date(Date.now() - 1000).toISOString() }), null)).rejects.toBeInstanceOf(BadRequestException);
    expect(campaignSave).not.toHaveBeenCalled();
  });

  it('drops the campaign when the delayed job cannot be queued', async () => {
    schedule.mockRejectedValueOnce(new Error('redis down'));
    await expect(service().broadcast(dto({ sendAt: new Date(Date.now() + 3600_000).toISOString() }), null)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(campaignSoftDelete).toHaveBeenCalledWith('c1');
  });

  it('cancels a scheduled campaign, and says why it cannot cancel another', async () => {
    await service().cancelCampaign('c1');
    expect(campaignSoftDelete).toHaveBeenCalledWith({ id: 'c1', status: NotificationCampaignStatus.SCHEDULED, deletedAt: expect.anything() });

    campaignSoftDelete.mockResolvedValueOnce({ affected: 0 });
    await expect(service().cancelCampaign('c1')).rejects.toBeInstanceOf(ConflictException);
    campaignSoftDelete.mockResolvedValueOnce({ affected: 0 });
    campaignExists.mockResolvedValueOnce(false);
    await expect(service().cancelCampaign('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resends and deletes one notification, 404 when it is gone', async () => {
    expect(await service().resend('n1')).toEqual({ id: 'n1', pushStatus: 'skipped' });
    resend.mockResolvedValueOnce(false);
    await expect(service().resend('n2')).rejects.toBeInstanceOf(NotFoundException);

    await service().remove('n1');
    expect(notificationSoftDelete).toHaveBeenCalledWith({ id: 'n1', deletedAt: expect.anything() });
    notificationSoftDelete.mockResolvedValueOnce({ affected: 0 });
    await expect(service().remove('n2')).rejects.toBeInstanceOf(NotFoundException);
  });
});
