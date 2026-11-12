import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Notification, NotificationCampaign, NotificationPushStatus, User } from '@app/database';
import { FcmSender } from './fcm.sender';
import { NOTIFICATION_CHANNELS, NotificationChannel } from './notification-channel';
import {
  NotificationPayload,
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

interface SavedRow {
  id: string;
  userId: string;
}

interface PushCounts {
  sent: number;
  failed: number;
  skipped: number;
}

type NormalizedPayload = Required<Omit<NotificationPayload, 'meta'>> & { meta: Record<string, unknown> | null };

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
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger('Notifications');
  /** Extra channels run one batch after another, in the background (in-process). */
  private channelQueue: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationCampaign) private readonly campaigns: Repository<NotificationCampaign>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly tokens: PushTokenStore,
    private readonly fcm: FcmSender,
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannel[],
    private readonly config: ConfigService,
  ) {}

  /**
   * Saves a notification for each user (`'all'` = every active, unblocked
   * user, in batches) and pushes it. Unknown or deleted user ids are ignored.
   */
  async send(to: string[] | 'all', payload: NotificationPayload, options: SendNotificationOptions = {}): Promise<SendNotificationResult> {
    const data = this.normalize(payload);
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
      }
      this.enqueueChannels(rows.map((r) => r.userId), data);
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
      .select(['n.id', 'n.userId', 'n.campaignId', 'n.type', 'n.title', 'n.body', 'n.link', 'n.image'])
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
    if (!rows.length) return 0;

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
    for (const group of groups.values()) {
      const first = group[0];
      const data = this.normalize(first);
      const platform = first.campaignId ? (platforms.get(first.campaignId) ?? null) : null;
      await this.pushRows(group, this.message(data, group, first.campaignId), platform);
    }
    return rows.length;
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
    const counts: PushCounts = { sent: 0, failed: 0, skipped: 0 };
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
  private async *recipients(to: string[] | 'all', platform: string | null): AsyncGenerator<string[]> {
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

    if (to === 'all') {
      let after: string | null = null;
      for (;;) {
        const qb = query().andWhere('u.isBlocked = false').limit(BATCH);
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
   * `send()` returns, one batch at a time. In-process: a restart drops what is
   * still waiting.
   */
  private enqueueChannels(userIds: string[], data: NormalizedPayload): void {
    if (!this.channels.length || !userIds.length) return;
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
}
