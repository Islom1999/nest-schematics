import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  Notification,
  NotificationCampaign,
  NotificationCampaignStatus,
  NotificationPushStatus,
  NotificationTarget,
  User,
} from '@app/database';
import { FcmSender } from './fcm.sender';
import { NOTIFICATION_CHANNELS, NotificationChannel } from './notification-channel';
import {
  NOTIFICATION_JOB,
  NOTIFICATION_JOBS,
  NOTIFICATION_QUEUE,
  NotificationJobQueue,
  NotificationPayload,
  NotificationRecipients,
  PushMessage,
  PushTarget,
  SendNotificationOptions,
  SendNotificationResult,
} from './notification.types';
import { PushTokenStore } from './push-token-store';

/** Users per batch: one INSERT, one token lookup and up to two FCM calls each. */
const BATCH = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Retry delay after attempt n: 1, 2, 4, 8... minutes, at most one hour. */
const RETRY_BASE_SECONDS = 60;
const RETRY_MAX_SECONDS = 3600;
/** A delayed job waits at most this long, then re-queues itself for the rest (long delays are fragile). */
const MAX_JOB_DELAY_MS = 7 * 24 * 3600 * 1000;
/** A job that fires a moment early still sends. */
const SCHEDULE_TOLERANCE_MS = 1000;

interface SavedRow {
  id: string;
  userId: string;
}

interface PushCounts {
  sent: number;
  failed: number;
  skipped: number;
  /** Rows whose push failed on every device (the retry covers them). */
  failedIds: string[];
}

/** Columns a push retry needs. */
const RETRY_COLUMNS = ['n.id', 'n.userId', 'n.campaignId', 'n.type', 'n.title', 'n.body', 'n.link', 'n.image'];

type NormalizedPayload = Required<Omit<NotificationPayload, 'meta'>> & { meta: Record<string, unknown> | null };

const isTopic = (to: NotificationRecipients): to is { topic: string } => typeof to === 'object' && !Array.isArray(to);

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Sends notifications: saves one `notifications` row per user first, then
 * pushes it to the user's signed-in devices through FCM, then hands it to the
 * extra channels (telegram, email) when installed. Inject it anywhere in the
 * API (the module is global):
 *
 *   await this.notifications.send([order.userId], { type: 'order', title: 'Order shipped', link: `/orders/${order.id}` });
 *   await this.notifications.send('all', { title: 'New version', body: 'Update the app' });
 *
 * Push results are stored per row (`pushStatus`, `pushAttempts`, `pushError`).
 * With the worker installed, failed pushes are retried with backoff
 * (`retryFailedPushes()`, up to NOTIFICATION_PUSH_MAX_ATTEMPTS); without it
 * there is a single attempt.
 *
 * With the queue add-on (BullMQ jobs, see `notification-jobs.module.ts`) the
 * slow parts become jobs: `send('all', ...)` runs as a `notifications.broadcast`
 * job, telegram/email deliveries are `notifications.channel` jobs, and failed
 * pushes are retried by the queue (attempts + backoff) instead of the cron job.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger('Notifications');
  /** Without the queue add-on: extra channels run one batch after another, in the background (in-process). */
  private channelQueue: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationCampaign) private readonly campaigns: Repository<NotificationCampaign>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly tokens: PushTokenStore,
    private readonly fcm: FcmSender,
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannel[],
    private readonly config: ConfigService,
    /** Only there with the queue add-on. */
    @Optional() @Inject(NOTIFICATION_JOBS) private readonly jobs: NotificationJobQueue | null = null,
  ) {}

  /**
   * Saves a notification for each user (`'all'` = every active, unblocked
   * user, in batches; `{ topic }` = the unblocked users subscribed to it) and
   * pushes it. Unknown or deleted user ids are ignored.
   */
  async send(to: NotificationRecipients, payload: NotificationPayload, options: SendNotificationOptions = {}): Promise<SendNotificationResult> {
    const data = this.normalize(payload);
    if (isTopic(to) && !to.topic) throw new BadRequestException('A topic needs a name');
    if ((to === 'all' || isTopic(to)) && this.jobs) {
      // The loop over every recipient is a job: no retries, it would save the rows twice.
      await this.jobs.enqueue(
        NOTIFICATION_JOB.broadcast,
        { payload: data, options, ...(isTopic(to) ? { topic: to.topic } : {}) },
        { queue: NOTIFICATION_QUEUE, attempts: 1 },
      );
      return { created: 0, pushSent: 0, pushFailed: 0, pushSkipped: 0, queued: true };
    }
    return this.sendNow(to, data, options);
  }

  /**
   * The `notifications.broadcast` job: sends to every user now and, for an
   * admin campaign, stores the totals on it (`sentCount`, `failedCount`).
   */
  async runBroadcast(payload: NotificationPayload, options: SendNotificationOptions, topic?: string): Promise<SendNotificationResult> {
    const result = await this.sendNow(topic ? { topic } : 'all', this.normalize(payload), options);
    if (options.campaignId) await this.storeTotals(options.campaignId, result);
    return result;
  }

  private storeTotals(campaignId: string, result: SendNotificationResult): Promise<unknown> {
    return this.campaigns.update(campaignId, {
      sentCount: result.created,
      failedCount: result.pushFailed,
      status: NotificationCampaignStatus.SENT,
    });
  }

  /**
   * Sends a saved campaign to its recipients now (`target` + `filters`) and
   * stores the totals on it. With the queue add-on a broadcast to everyone or
   * to a topic is a job, so its totals arrive when the job is done.
   */
  async sendCampaign(campaign: NotificationCampaign): Promise<SendNotificationResult> {
    let to: NotificationRecipients = 'all';
    if (campaign.target === NotificationTarget.USERS) to = campaign.filters?.userIds ?? [];
    if (campaign.target === NotificationTarget.TOPIC) to = { topic: campaign.filters?.topic ?? '' };
    const result = await this.send(
      to,
      { type: campaign.type, title: campaign.title, body: campaign.body, link: campaign.link, image: campaign.image, meta: campaign.meta },
      { campaignId: campaign.id, platform: campaign.target === NotificationTarget.PLATFORM ? (campaign.filters?.platform ?? null) : null },
    );
    if (!result.queued) await this.storeTotals(campaign.id, result);
    return result;
  }

  /**
   * With the queue add-on: a delayed `notifications.scheduled` job for a
   * `scheduled` campaign (at most a week at a time; the job re-queues itself
   * for the rest). Without the queue the worker's cron job picks the campaign
   * up (`dispatchDueCampaigns()`), so this does nothing.
   */
  async schedule(campaign: NotificationCampaign): Promise<void> {
    if (!this.jobs || !campaign.sendAt) return;
    const delay = Math.min(Math.max(campaign.sendAt.getTime() - Date.now(), 0), MAX_JOB_DELAY_MS);
    // No retries: a retry after a partial send would save the rows twice.
    await this.jobs.enqueue(NOTIFICATION_JOB.scheduled, { campaignId: campaign.id }, { queue: NOTIFICATION_QUEUE, attempts: 1, delay });
  }

  /**
   * Sends one scheduled campaign: the `notifications.scheduled` job, and the
   * cron job through {@link dispatchDueCampaigns}. The campaign is claimed
   * first (`scheduled` to `sending`), so it goes out once whoever gets there
   * first, and a cancelled (deleted) campaign never does.
   *
   * @returns the totals, or null when there was nothing to send (gone, already sent, not due yet).
   */
  async dispatchCampaign(id: string, options: { onlyDue?: boolean } = {}): Promise<SendNotificationResult | null> {
    const campaign = await this.campaigns.findOne({ where: { id } });
    if (!campaign || campaign.status !== NotificationCampaignStatus.SCHEDULED) return null;
    if (campaign.sendAt && campaign.sendAt.getTime() > Date.now() + SCHEDULE_TOLERANCE_MS) {
      if (!options.onlyDue) await this.schedule(campaign);
      return null;
    }
    const claim = await this.campaigns.update(
      { id, status: NotificationCampaignStatus.SCHEDULED, deletedAt: IsNull() },
      { status: NotificationCampaignStatus.SENDING },
    );
    if (!claim.affected) return null;
    try {
      return await this.sendCampaign(campaign);
    } catch (error) {
      await this.campaigns.update(id, { status: NotificationCampaignStatus.FAILED });
      throw error;
    }
  }

  /** The worker's cron job (no queue): sends the scheduled campaigns whose `sendAt` has passed. @returns how many were sent. */
  async dispatchDueCampaigns(limit = 20): Promise<number> {
    const due = await this.campaigns.find({
      select: { id: true },
      where: { status: NotificationCampaignStatus.SCHEDULED, sendAt: LessThanOrEqual(new Date()) },
      order: { sendAt: 'ASC' },
      take: limit,
    });
    let sent = 0;
    for (const { id } of due) {
      try {
        if (await this.dispatchCampaign(id, { onlyDue: true })) sent++;
      } catch (error) {
        this.logger.error(`Scheduled campaign ${id} failed: ${(error as Error).message}`);
      }
    }
    return sent;
  }

  /**
   * Delivers one saved notification again (admin "resend"): marks it unread
   * and pending, pushes it to the user's devices once more and hands it to the
   * extra channels. The push result is stored on the row as usual.
   *
   * @returns false when the notification does not exist (or was deleted).
   */
  async resend(id: string): Promise<boolean> {
    const row = await this.notifications.createQueryBuilder('n').select(RETRY_COLUMNS).where('n.id = :id', { id }).getOne();
    if (!row) return false;
    await this.notifications.update({ id }, { readAt: null, pushStatus: NotificationPushStatus.PENDING, pushError: null });
    await this.pushAgain([row]);
    await this.enqueueChannels([row.userId], this.normalize(row));
    return true;
  }

  /** The `notifications.channel` job: one batch of users for one extra channel. Throws, so the queue retries. */
  async deliverChannel(name: string, userIds: string[], payload: NotificationPayload): Promise<void> {
    const channel = this.channels.find((c) => c.name === name);
    if (!channel) throw new Error(`Notification channel "${name}" is not set up in this process`);
    await channel.deliver(userIds, payload);
  }

  /**
   * The `notifications.push-retry` job: pushes the still-failed, unread rows of
   * `ids` again. Throws while some still fail, so the queue retries with backoff.
   */
  async retryPush(ids: string[]): Promise<number> {
    if (!ids.length || (await this.fcm.disabledReason())) return 0;
    const rows = await this.notifications
      .createQueryBuilder('n')
      .select(RETRY_COLUMNS)
      .where('n.id IN (:...ids)', { ids })
      .andWhere('n.pushStatus = :failed', { failed: NotificationPushStatus.FAILED })
      .andWhere('n.readAt IS NULL')
      .getMany();
    const { retried, failed } = await this.pushAgain(rows);
    if (failed) throw new Error(`${failed} of ${retried} push(es) failed again`);
    return retried;
  }

  private async sendNow(to: NotificationRecipients, data: NormalizedPayload, options: SendNotificationOptions): Promise<SendNotificationResult> {
    const result: SendNotificationResult = { created: 0, pushSent: 0, pushFailed: 0, pushSkipped: 0 };
    for await (const userIds of this.recipients(to, options.platform ?? null)) {
      const rows = await this.saveRows(userIds, data, options);
      result.created += rows.length;
      if (options.push === false) {
        result.pushSkipped += rows.length;
      } else {
        const counts = await this.pushRows(rows, this.message(data, rows, options.campaignId ?? null), options.platform ?? null);
        result.pushSent += counts.sent;
        result.pushFailed += counts.failed;
        result.pushSkipped += counts.skipped;
        await this.enqueuePushRetry(counts.failedIds);
      }
      await this.enqueueChannels(rows.map((r) => r.userId), data);
    }
    return result;
  }

  /**
   * Pushes the failed notifications again (worker job, every minute): rows with
   * fewer than NOTIFICATION_PUSH_MAX_ATTEMPTS attempts whose backoff has passed
   * (1, 2, 4... minutes, at most an hour) and that are still unread.
   *
   * @returns how many notifications were retried.
   */
  async retryFailedPushes(limit = BATCH): Promise<number> {
    if (await this.fcm.disabledReason()) return 0;
    const rows = await this.notifications
      .createQueryBuilder('n')
      .select(RETRY_COLUMNS)
      .where('n.pushStatus = :failed', { failed: NotificationPushStatus.FAILED })
      .andWhere('n.pushAttempts < :max', { max: this.maxAttempts() })
      .andWhere('n.readAt IS NULL')
      .andWhere(
        'n.updatedAt <= now() - make_interval(secs => LEAST(:maxDelay, :baseDelay * power(2, GREATEST(n.pushAttempts, 1) - 1)))',
        { maxDelay: RETRY_MAX_SECONDS, baseDelay: RETRY_BASE_SECONDS },
      )
      .orderBy('n.createdAt', 'ASC')
      .limit(limit)
      .getMany();
    return (await this.pushAgain(rows)).retried;
  }

  /** Pushes these (failed) rows again, one message per campaign. */
  private async pushAgain(rows: Notification[]): Promise<{ retried: number; failed: number }> {
    if (!rows.length) return { retried: 0, failed: 0 };
    // Rows of one campaign share the message, so they go out together.
    const groups = new Map<string, Notification[]>();
    for (const row of rows) {
      const key = row.campaignId ?? row.id;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const campaignIds = [...new Set(rows.map((r) => r.campaignId).filter((id): id is string => !!id))];
    const platforms = new Map<string, string | null>();
    if (campaignIds.length) {
      const campaigns = await this.campaigns.find({ select: { id: true, filters: true }, where: { id: In(campaignIds) } });
      for (const c of campaigns) platforms.set(c.id, c.filters?.platform ?? null);
    }
    let failed = 0;
    for (const group of groups.values()) {
      const first = group[0];
      const data = this.normalize(first);
      const platform = first.campaignId ? (platforms.get(first.campaignId) ?? null) : null;
      failed += (await this.pushRows(group, this.message(data, group, first.campaignId), platform)).failed;
    }
    return { retried: rows.length, failed };
  }


  /** NOTIFICATION_PUSH_MAX_ATTEMPTS (default 5). */
  maxAttempts(): number {
    const value = Number(this.config.get<string>('NOTIFICATION_PUSH_MAX_ATTEMPTS'));
    return Number.isInteger(value) && value > 0 ? value : 5;
  }

  /**
   * Pushes one message to the devices of these rows' users and stores the
   * outcome per row: `sent` when a device accepted it, `failed` (retried by the
   * worker) when every device failed, `skipped` when push is off or the user
   * has no device. Dead tokens are removed from their sessions.
   */
  private async pushRows(rows: SavedRow[], message: PushMessage, platform: string | null): Promise<PushCounts> {
    const counts: PushCounts = { sent: 0, failed: 0, skipped: 0, failedIds: [] };
    if (!rows.length) return counts;

    const disabled = await this.fcm.disabledReason();
    if (disabled) {
      await this.setPushStatus(rows.map((r) => r.id), NotificationPushStatus.SKIPPED, disabled, false);
      counts.skipped = rows.length;
      return counts;
    }

    const targets = (await this.tokens.activePushTokens(rows.map((r) => r.userId))).filter((t) => !platform || t.platform === platform);
    const byToken = new Map<string, PushTarget[]>();
    for (const t of targets) byToken.set(t.token, [...(byToken.get(t.token) ?? []), t]);

    const outcome = new Map<string, { ok: boolean; error?: string }>();
    if (byToken.size) {
      const results = (await this.fcm.sendMulticast([...byToken.keys()], message)) ?? [];
      for (const r of results) {
        for (const t of byToken.get(r.token) ?? []) {
          if (r.invalid) {
            await this.tokens.clearPushToken(t.sessionId);
          } else if (r.ok) {
            outcome.set(t.userId, { ok: true });
          } else if (!outcome.has(t.userId)) {
            outcome.set(t.userId, { ok: false, error: r.error });
          }
        }
      }
    }

    const withDevice = new Set(targets.map((t) => t.userId));
    const updates = new Map<string, { status: NotificationPushStatus; error: string | null; attempted: boolean; ids: string[] }>();
    const add = (id: string, status: NotificationPushStatus, error: string | null, attempted: boolean) => {
      const key = `${status}|${attempted}|${error ?? ''}`;
      const entry = updates.get(key) ?? { status, error, attempted, ids: [] };
      entry.ids.push(id);
      updates.set(key, entry);
    };
    for (const row of rows) {
      const result = outcome.get(row.userId);
      if (!withDevice.has(row.userId)) {
        add(row.id, NotificationPushStatus.SKIPPED, 'No push token', false);
        counts.skipped++;
      } else if (result?.ok) {
        add(row.id, NotificationPushStatus.SENT, null, true);
        counts.sent++;
      } else if (result) {
        add(row.id, NotificationPushStatus.FAILED, result.error ?? 'Push failed', true);
        counts.failed++;
        counts.failedIds.push(row.id);
      } else {
        add(row.id, NotificationPushStatus.SKIPPED, 'Push tokens were invalid (removed)', true);
        counts.skipped++;
      }
    }
    for (const u of updates.values()) await this.setPushStatus(u.ids, u.status, u.error, u.attempted);
    return counts;
  }

  private async setPushStatus(ids: string[], status: NotificationPushStatus, error: string | null, attempted: boolean): Promise<void> {
    for (const part of chunks(ids, BATCH)) {
      await this.notifications.update(
        { id: In(part) },
        {
          pushStatus: status,
          pushError: error ? error.slice(0, 500) : null,
          ...(attempted ? { pushAttempts: () => 'push_attempts + 1' } : {}),
        },
      );
    }
  }

  private async saveRows(userIds: string[], data: NormalizedPayload, options: SendNotificationOptions): Promise<SavedRow[]> {
    if (!userIds.length) return [];
    const result = await this.notifications.insert(
      userIds.map((userId): QueryDeepPartialEntity<Notification> => ({
        userId,
        type: data.type,
        title: data.title,
        body: data.body,
        link: data.link,
        image: data.image,
        // jsonb: TypeORM serialises the object.
        meta: data.meta as QueryDeepPartialEntity<Record<string, unknown>> | null,
        campaignId: options.campaignId ?? null,
        pushStatus: options.push === false ? NotificationPushStatus.SKIPPED : NotificationPushStatus.PENDING,
      })),
    );
    return userIds.map((userId, i) => ({ id: String(result.identifiers[i]['id']), userId }));
  }

  /** Recipient ids in batches of {@link BATCH}. */
  private async *recipients(to: NotificationRecipients, platform: string | null): AsyncGenerator<string[]> {
    const query = () => {
      const qb = this.users.createQueryBuilder('u').select('u.id', 'id').orderBy('u.id', 'ASC');
      if (platform) {
        qb.andWhere(
          `EXISTS (SELECT 1 FROM "user_sessions" "s" WHERE "s"."user_id" = "u"."id" AND "s"."push_platform" = :platform ` +
            `AND "s"."revoked_at" IS NULL AND "s"."expires_at" > now() AND "s"."deleted_at" IS NULL)`,
          { platform },
        );
      }
      return qb;
    };

    if (to === 'all' || isTopic(to)) {
      let after: string | null = null;
      for (;;) {
        const qb = query().andWhere('u.isBlocked = false').limit(BATCH);
        if (isTopic(to)) {
          qb.andWhere(
            `EXISTS (SELECT 1 FROM "notification_topics" "t" WHERE "t"."user_id" = "u"."id" AND "t"."topic" = :topic AND "t"."deleted_at" IS NULL)`,
            { topic: to.topic },
          );
        }
        if (after) qb.andWhere('u.id > :after', { after });
        const ids = (await qb.getRawMany<{ id: string }>()).map((r) => r.id);
        if (ids.length) yield ids;
        if (ids.length < BATCH) return;
        after = ids[ids.length - 1];
      }
    }

    const wanted = [...new Set(to)].filter((id) => UUID_RE.test(id));
    for (const part of chunks(wanted, BATCH)) {
      const ids = (await query().andWhere('u.id IN (:...ids)', { ids: part }).getRawMany<{ id: string }>()).map((r) => r.id);
      if (ids.length) yield ids;
    }
  }

  private normalize(payload: NotificationPayload): NormalizedPayload {
    const title = (payload.title ?? '').trim();
    if (!title) throw new BadRequestException('A notification needs a title');
    return {
      type: payload.type?.trim() || 'general',
      title: title.slice(0, 200),
      body: payload.body ?? '',
      link: payload.link?.trim() || null,
      image: payload.image?.trim() || null,
      meta: payload.meta ?? null,
    };
  }

  /** The push of a batch. `notificationId` is only known when the batch has one user. */
  private message(data: NormalizedPayload, rows: SavedRow[], campaignId: string | null): PushMessage {
    return {
      title: data.title,
      body: data.body,
      image: data.image,
      data: {
        type: data.type,
        ...(data.link ? { link: data.link } : {}),
        ...(campaignId ? { campaignId } : {}),
        ...(rows.length === 1 ? { notificationId: rows[0].id } : {}),
      },
    };
  }

  /**
   * Extra channels (telegram, email) are slow (rate limits), so they run after
   * `send()` returns. With the queue add-on each channel gets a
   * `notifications.channel` job (retried with backoff, survives a restart);
   * without it they run in-process, one batch at a time, and a restart drops
   * what is still waiting.
   */
  private async enqueueChannels(userIds: string[], data: NormalizedPayload): Promise<void> {
    if (!this.channels.length || !userIds.length) return;
    if (this.jobs) {
      for (const channel of this.channels) {
        try {
          await this.jobs.enqueue(NOTIFICATION_JOB.channel, { channel: channel.name, userIds, payload: data }, { queue: NOTIFICATION_QUEUE });
        } catch (error) {
          // The rows are saved; a queue outage must not fail send().
          this.logger.error(`Could not queue channel ${channel.name} for ${userIds.length} user(s): ${(error as Error).message}`);
        }
      }
      return;
    }
    this.channelQueue = this.channelQueue.then(async () => {
      for (const channel of this.channels) {
        try {
          await channel.deliver(userIds, data);
        } catch (error) {
          this.logger.error(`Channel ${channel.name} failed for ${userIds.length} user(s): ${(error as Error).message}`);
        }
      }
    });
  }

  /**
   * With the queue add-on, failed pushes are retried by BullMQ instead of the
   * worker's cron job: one job per batch, first run and every retry delayed
   * 1, 2, 4... minutes, NOTIFICATION_PUSH_MAX_ATTEMPTS - 1 runs in all (the
   * first attempt already happened).
   */
  private async enqueuePushRetry(failedIds: string[]): Promise<void> {
    const attempts = this.maxAttempts() - 1;
    if (!this.jobs || !failedIds.length || attempts < 1) return;
    for (const ids of chunks(failedIds, BATCH)) {
      try {
        await this.jobs.enqueue(
          NOTIFICATION_JOB.pushRetry,
          { ids },
          { queue: NOTIFICATION_QUEUE, attempts, delay: RETRY_BASE_SECONDS * 1000, backoff: { type: 'exponential', delay: RETRY_BASE_SECONDS * 1000 } },
        );
      } catch (error) {
        this.logger.error(`Could not queue the push retry for ${ids.length} notification(s): ${(error as Error).message}`);
      }
    }
  }
}
