import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Notification, NotificationCampaign, NotificationCampaignStatus, NotificationPushStatus, NotificationTarget, User } from '@app/database';
import { FCM_MULTICAST_LIMIT, FcmSender } from './fcm.sender';
import { parseServiceAccount } from './firebase-credentials';
import { NotificationChannel } from './notification-channel';
import { NotificationService } from './notification.service';
import { NotificationJobQueue, PushTarget } from './notification.types';
import { PushTokenStore } from './push-token-store';

const mockSendEach = jest.fn();
const mockInitializeApp = jest.fn((..._args: unknown[]) => ({ name: 'notifications' }));

jest.mock('firebase-admin/app', () => ({
  cert: (account: unknown) => account,
  getApps: () => [],
  initializeApp: (...args: unknown[]) => mockInitializeApp(...args),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEachForMulticast: mockSendEach }),
}));

const ACCOUNT = { project_id: 'demo-project', client_email: 'push@demo-project.iam.gserviceaccount.com', private_key: 'not-a-real-key' };
const ACCOUNT_JSON = JSON.stringify(ACCOUNT);
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

function config(values: Record<string, string> = {}): ConfigService {
  return new ConfigService(values);
}

/** FCM answers every token: ok unless listed in `invalid` / `failing`. */
function answer(invalid: string[] = [], failing: string[] = []) {
  mockSendEach.mockImplementation(async (message: { tokens: string[] }) => ({
    responses: message.tokens.map((token) =>
      invalid.includes(token)
        ? { success: false, error: { code: 'messaging/registration-token-not-registered', message: 'gone' } }
        : failing.includes(token)
          ? { success: false, error: { code: 'messaging/internal-error', message: 'try later' } }
          : { success: true, messageId: `m-${token}` },
    ),
  }));
}

beforeAll(() => Logger.overrideLogger(false));

beforeEach(() => {
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.SWAGGER_EXPORT;
  mockSendEach.mockReset();
  mockInitializeApp.mockClear();
});

describe('parseServiceAccount', () => {
  it('reads raw and base64 JSON', () => {
    const expected = { projectId: 'demo-project', clientEmail: ACCOUNT.client_email, privateKey: 'not-a-real-key' };
    expect(parseServiceAccount(ACCOUNT_JSON)).toEqual(expected);
    expect(parseServiceAccount(Buffer.from(ACCOUNT_JSON).toString('base64'))).toEqual(expected);
  });

  it('never puts the value in its errors', () => {
    const secret = '{"private_key": "very-secret-value"';
    expect(() => parseServiceAccount(secret)).toThrow(/not valid JSON/);
    try {
      parseServiceAccount(secret);
    } catch (error) {
      expect((error as Error).message).not.toContain('very-secret-value');
    }
    expect(() => parseServiceAccount('{"project_id":"x"}')).toThrow('missing client_email, private_key');
  });
});

describe('FcmSender', () => {
  it('sends in chunks of 500 tokens', async () => {
    answer();
    const sender = new FcmSender(config({ FIREBASE_SERVICE_ACCOUNT_JSON: ACCOUNT_JSON }));
    const tokens = Array.from({ length: 1200 }, (_, i) => `t${i}`);
    const results = await sender.sendMulticast(tokens, { title: 'Hi', body: 'There', data: { type: 'general' } });

    expect(FCM_MULTICAST_LIMIT).toBe(500);
    expect(mockSendEach.mock.calls.map(([m]) => (m as { tokens: string[] }).tokens.length)).toEqual([500, 500, 200]);
    expect(results?.length).toBe(1200);
    expect(results?.every((r) => r.ok)).toBe(true);
    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
  });

  it('marks unregistered tokens invalid and keeps other errors retryable', async () => {
    answer(['dead'], ['flaky']);
    const sender = new FcmSender(config({ FIREBASE_SERVICE_ACCOUNT_JSON: ACCOUNT_JSON }));
    const results = await sender.sendMulticast(['ok', 'dead', 'flaky'], { title: 'Hi', body: '', data: {} });
    expect(results?.map((r) => [r.token, r.ok, r.invalid])).toEqual([
      ['ok', true, false],
      ['dead', false, true],
      ['flaky', false, false],
    ]);
  });

  it('is off without FIREBASE_SERVICE_ACCOUNT_JSON and during swagger:export', async () => {
    const off = new FcmSender(config());
    expect(await off.disabledReason()).toMatch(/not configured/);
    expect(await off.sendMulticast(['t'], { title: 'Hi', body: '', data: {} })).toBeNull();

    process.env.SWAGGER_EXPORT = '1';
    const exporting = new FcmSender(config({ FIREBASE_SERVICE_ACCOUNT_JSON: ACCOUNT_JSON }));
    expect(await exporting.disabledReason()).not.toBeNull();
    expect(mockInitializeApp).not.toHaveBeenCalled();
    expect(mockSendEach).not.toHaveBeenCalled();
  });

  it('turns push off on invalid credentials instead of failing', async () => {
    const sender = new FcmSender(config({ FIREBASE_SERVICE_ACCOUNT_JSON: 'not json at all' }));
    expect(await sender.disabledReason()).toBe('FIREBASE_SERVICE_ACCOUNT_JSON is invalid');
  });
});

describe('NotificationService', () => {
  const insert = jest.fn(async (values: unknown[]) => ({ identifiers: values.map((_, i) => ({ id: `n${i + 1}` })) }));
  const update = jest.fn(async (..._args: unknown[]) => ({ affected: 1 }));
  const activePushTokens = jest.fn(async (_userIds: string[]): Promise<PushTarget[]> => []);
  const clearPushToken = jest.fn(async (_sessionId: string) => undefined);

  const andWhere = jest.fn();
  const getOne = jest.fn(async (): Promise<unknown> => null);
  const campaignFindOne = jest.fn(async (..._args: unknown[]): Promise<unknown> => null);
  const campaignFind = jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []);
  const campaignUpdate = jest.fn(async (..._args: unknown[]) => ({ affected: 1 }));

  function service(values: Record<string, string> = {}, jobs: NotificationJobQueue | null = null, channels: NotificationChannel[] = []): NotificationService {
    const qb = {
      select: () => qb,
      orderBy: () => qb,
      limit: () => qb,
      andWhere: (...args: unknown[]) => {
        andWhere(...args);
        return qb;
      },
      getRawMany: async () => [{ id: U1 }, { id: U2 }],
    };
    const rowQuery = { select: () => rowQuery, where: () => rowQuery, getOne };
    const store: PushTokenStore = { activePushTokens, clearPushToken };
    return new NotificationService(
      { insert, update, createQueryBuilder: () => rowQuery } as unknown as Repository<Notification>,
      { findOne: campaignFindOne, find: campaignFind, update: campaignUpdate } as unknown as Repository<NotificationCampaign>,
      { createQueryBuilder: () => qb } as unknown as Repository<User>,
      store,
      new FcmSender(config(values)),
      channels,
      config(values),
      jobs,
    );
  }

  /** `update()` calls as [ids, pushStatus, pushError]. */
  function statusUpdates() {
    return update.mock.calls.map(([where, set]) => {
      const ids = (where as { id: { value: string[] } }).id.value;
      const values = set as { pushStatus: NotificationPushStatus; pushError: string | null };
      return [ids, values.pushStatus, values.pushError];
    });
  }

  beforeEach(() => {
    insert.mockClear();
    update.mockClear();
    activePushTokens.mockReset();
    activePushTokens.mockResolvedValue([]);
    clearPushToken.mockClear();
    andWhere.mockClear();
    getOne.mockReset();
    getOne.mockResolvedValue(null);
    campaignFindOne.mockReset();
    campaignFindOne.mockResolvedValue(null);
    campaignFind.mockReset();
    campaignFind.mockResolvedValue([]);
    campaignUpdate.mockClear();
    campaignUpdate.mockResolvedValue({ affected: 1 });
  });

  it('saves the rows first and marks them skipped when FCM is not configured', async () => {
    const result = await service().send([U1, U2, 'not-a-uuid'], { title: 'Hello', body: 'World' });

    expect(insert).toHaveBeenCalledTimes(1);
    expect((insert.mock.calls[0][0] as { userId: string }[]).map((r) => r.userId)).toEqual([U1, U2]);
    expect(activePushTokens).not.toHaveBeenCalled();
    expect(mockSendEach).not.toHaveBeenCalled();
    expect(statusUpdates()).toEqual([[['n1', 'n2'], NotificationPushStatus.SKIPPED, 'Push is not configured (FIREBASE_SERVICE_ACCOUNT_JSON)']]);
    expect(result).toEqual({ created: 2, pushSent: 0, pushFailed: 0, pushSkipped: 2 });
  });

  it('clears invalid tokens from their sessions and stores the outcome per user', async () => {
    activePushTokens.mockResolvedValue([
      { userId: U1, sessionId: 's-a', token: 'tok-a', platform: 'android' },
      { userId: U1, sessionId: 's-b', token: 'tok-b', platform: 'ios' },
      { userId: U2, sessionId: 's-c', token: 'tok-c', platform: 'android' },
    ]);
    answer(['tok-b', 'tok-c']);
    const result = await service({ FIREBASE_SERVICE_ACCOUNT_JSON: ACCOUNT_JSON }).send([U1, U2], { title: 'Hello' });

    expect(clearPushToken.mock.calls.map(([id]) => id)).toEqual(['s-b', 's-c']);
    expect(statusUpdates()).toEqual([
      [['n1'], NotificationPushStatus.SENT, null],
      [['n2'], NotificationPushStatus.SKIPPED, 'Push tokens were invalid (removed)'],
    ]);
    expect(result).toEqual({ created: 2, pushSent: 1, pushFailed: 0, pushSkipped: 1 });
  });

  it('marks failed pushes for the retry job and skips users without devices', async () => {
    activePushTokens.mockResolvedValue([{ userId: U1, sessionId: 's-a', token: 'tok-a', platform: 'android' }]);
    answer([], ['tok-a']);
    const result = await service({ FIREBASE_SERVICE_ACCOUNT_JSON: ACCOUNT_JSON }).send([U1, U2], { title: 'Hello' });

    expect(clearPushToken).not.toHaveBeenCalled();
    expect(statusUpdates()).toEqual([
      [['n1'], NotificationPushStatus.FAILED, 'messaging/internal-error: try later'],
      [['n2'], NotificationPushStatus.SKIPPED, 'No push token'],
    ]);
    expect(result.pushFailed).toBe(1);
  });

  describe('with the queue add-on', () => {
    const enqueue = jest.fn(async (..._args: unknown[]) => ({ id: 'j1' }));
    const jobs: NotificationJobQueue = { enqueue };
    const deliver = jest.fn(async (..._args: unknown[]) => undefined);
    const channel: NotificationChannel = { name: 'email', deliver };

    beforeEach(() => {
      enqueue.mockClear();
      deliver.mockClear();
    });

    it('turns a broadcast to everyone into one job and saves nothing yet', async () => {
      const result = await service({}, jobs).send('all', { title: 'Hello' }, { campaignId: 'c1' });

      expect(insert).not.toHaveBeenCalled();
      expect(result).toEqual({ created: 0, pushSent: 0, pushFailed: 0, pushSkipped: 0, queued: true });
      expect(enqueue).toHaveBeenCalledTimes(1);
      const [name, data, opts] = enqueue.mock.calls[0] as [string, { options: unknown }, { attempts: number }];
      expect(name).toBe('notifications.broadcast');
      expect(data.options).toEqual({ campaignId: 'c1' });
      expect(opts.attempts).toBe(1);
    });

    it('still sends to listed users right away, and queues one job per extra channel', async () => {
      const result = await service({}, jobs, [channel]).send([U1, U2], { title: 'Hello' });

      expect(result.created).toBe(2);
      expect(enqueue.mock.calls.map(([name, data]) => [name, (data as { channel: string }).channel])).toEqual([['notifications.channel', 'email']]);
      expect(deliver).not.toHaveBeenCalled();
    });

    it('queues a push retry for the failed rows, one run fewer than NOTIFICATION_PUSH_MAX_ATTEMPTS', async () => {
      activePushTokens.mockResolvedValue([{ userId: U1, sessionId: 's-a', token: 'tok-a', platform: 'android' }]);
      answer([], ['tok-a']);
      await service({ FIREBASE_SERVICE_ACCOUNT_JSON: ACCOUNT_JSON, NOTIFICATION_PUSH_MAX_ATTEMPTS: '4' }, jobs).send([U1, U2], { title: 'Hello' });

      expect(enqueue).toHaveBeenCalledTimes(1);
      const [name, data, opts] = enqueue.mock.calls[0] as [string, { ids: string[] }, { attempts: number; backoff: { type: string } }];
      expect(name).toBe('notifications.push-retry');
      expect(data.ids).toEqual(['n1']);
      expect(opts.attempts).toBe(3);
      expect(opts.backoff.type).toBe('exponential');
    });

    it('does not queue a retry when only one attempt is allowed', async () => {
      activePushTokens.mockResolvedValue([{ userId: U1, sessionId: 's-a', token: 'tok-a', platform: 'android' }]);
      answer([], ['tok-a']);
      await service({ FIREBASE_SERVICE_ACCOUNT_JSON: ACCOUNT_JSON, NOTIFICATION_PUSH_MAX_ATTEMPTS: '1' }, jobs).send([U1], { title: 'Hello' });
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('delivers a channel job through the channel of that name, and fails for an unknown one', async () => {
      const svc = service({}, jobs, [channel]);
      await svc.deliverChannel('email', [U1], { title: 'Hello' });
      expect(deliver).toHaveBeenCalledWith([U1], { title: 'Hello' });
      await expect(svc.deliverChannel('telegram', [U1], { title: 'Hello' })).rejects.toThrow('not set up');
    });
  });

  describe('topics', () => {
    it('sends to the unblocked subscribers of the topic', async () => {
      const result = await service().send({ topic: 'news' }, { title: 'Hello' });

      const filter = andWhere.mock.calls.find(([sql]) => String(sql).includes('"notification_topics"'));
      expect(filter?.[1]).toEqual({ topic: 'news' });
      expect(andWhere.mock.calls.some(([sql]) => sql === 'u.isBlocked = false')).toBe(true);
      expect(result.created).toBe(2);
    });

    it('needs a topic name', async () => {
      await expect(service().send({ topic: '' }, { title: 'Hello' })).rejects.toThrow('A topic needs a name');
    });

    it('turns a topic broadcast into a job that carries the topic', async () => {
      const enqueue = jest.fn(async (..._args: unknown[]) => ({ id: 'j1' }));
      const result = await service({}, { enqueue }).send({ topic: 'news' }, { title: 'Hello' }, { campaignId: 'c1' });

      expect(result.queued).toBe(true);
      expect(insert).not.toHaveBeenCalled();
      const [name, data] = enqueue.mock.calls[0] as [string, { topic: string; options: unknown }];
      expect([name, data.topic, data.options]).toEqual(['notifications.broadcast', 'news', { campaignId: 'c1' }]);
    });

    it('runs the broadcast job for the topic and marks the campaign sent', async () => {
      const result = await service().runBroadcast({ title: 'Hello' }, { campaignId: 'c1' }, 'news');

      expect(result.created).toBe(2);
      expect(andWhere.mock.calls.some(([sql]) => String(sql).includes('"notification_topics"'))).toBe(true);
      expect(campaignUpdate).toHaveBeenCalledWith('c1', { sentCount: 2, failedCount: 0, status: NotificationCampaignStatus.SENT });
    });
  });

  describe('scheduled campaigns', () => {
    const enqueue = jest.fn(async (..._args: unknown[]) => ({ id: 'j1' }));
    const jobs: NotificationJobQueue = { enqueue };
    const campaign = (extra: Partial<NotificationCampaign> = {}) =>
      ({
        id: 'c1',
        target: NotificationTarget.USERS,
        filters: { userIds: [U1] },
        type: 'promo',
        title: 'Sale',
        body: '',
        link: null,
        image: null,
        meta: null,
        status: NotificationCampaignStatus.SCHEDULED,
        sendAt: new Date(Date.now() - 1000),
        ...extra,
      }) as NotificationCampaign;

    beforeEach(() => enqueue.mockClear());

    it('queues a delayed job at sendAt, one run only, and does nothing without the queue', async () => {
      const sendAt = new Date(Date.now() + 3600_000);
      await service({}, jobs).schedule(campaign({ sendAt }));

      const [name, data, opts] = enqueue.mock.calls[0] as [string, { campaignId: string }, { delay: number; attempts: number; queue: string }];
      expect([name, data.campaignId, opts.attempts, opts.queue]).toEqual(['notifications.scheduled', 'c1', 1, 'notifications']);
      expect(opts.delay).toBeGreaterThan(3500_000);
      expect(opts.delay).toBeLessThanOrEqual(3600_000);

      enqueue.mockClear();
      await service().schedule(campaign({ sendAt }));
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('waits at most a week per job and re-queues itself for the rest', async () => {
      const far = campaign({ sendAt: new Date(Date.now() + 30 * 24 * 3600_000) });
      await service({}, jobs).schedule(far);
      expect((enqueue.mock.calls[0][2] as { delay: number }).delay).toBe(7 * 24 * 3600_000);

      enqueue.mockClear();
      campaignFindOne.mockResolvedValue(far);
      expect(await service({}, jobs).dispatchCampaign('c1')).toBeNull();
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(insert).not.toHaveBeenCalled();
    });

    it('claims the campaign, sends it once and stores the totals', async () => {
      campaignFindOne.mockResolvedValue(campaign());
      const result = await service().dispatchCampaign('c1');

      expect(result).toEqual({ created: 2, pushSent: 0, pushFailed: 0, pushSkipped: 2 });
      const [claimWhere, claimSet] = campaignUpdate.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(claimWhere).toEqual(expect.objectContaining({ id: 'c1', status: NotificationCampaignStatus.SCHEDULED }));
      expect(claimSet).toEqual({ status: NotificationCampaignStatus.SENDING });
      expect(campaignUpdate).toHaveBeenLastCalledWith('c1', { sentCount: 2, failedCount: 0, status: NotificationCampaignStatus.SENT });
      expect((insert.mock.calls[0][0] as { userId: string; campaignId: string }[]).map((r) => [r.userId, r.campaignId])).toEqual([[U1, 'c1'], [U2, 'c1']]);
    });

    it('sends nothing when the campaign is gone, not scheduled, claimed by someone else or not due', async () => {
      expect(await service().dispatchCampaign('c1')).toBeNull();

      campaignFindOne.mockResolvedValue(campaign({ status: NotificationCampaignStatus.SENT }));
      expect(await service().dispatchCampaign('c1')).toBeNull();

      campaignFindOne.mockResolvedValue(campaign());
      campaignUpdate.mockResolvedValueOnce({ affected: 0 });
      expect(await service().dispatchCampaign('c1')).toBeNull();

      campaignFindOne.mockResolvedValue(campaign({ sendAt: new Date(Date.now() + 3600_000) }));
      campaignUpdate.mockClear();
      expect(await service().dispatchCampaign('c1', { onlyDue: true })).toBeNull();
      expect(campaignUpdate).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it('marks the campaign failed when the send throws', async () => {
      campaignFindOne.mockResolvedValue(campaign());
      insert.mockRejectedValueOnce(new Error('db down'));
      await expect(service().dispatchCampaign('c1')).rejects.toThrow('db down');
      expect(campaignUpdate).toHaveBeenLastCalledWith('c1', { status: NotificationCampaignStatus.FAILED });
    });

    it('the cron job sends every due campaign and survives a failing one', async () => {
      campaignFind.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
      campaignFindOne.mockImplementation(async (...args: unknown[]) => {
        const id = (args[0] as { where: { id: string } }).where.id;
        return campaign({ id });
      });
      insert.mockRejectedValueOnce(new Error('db down'));
      expect(await service().dispatchDueCampaigns()).toBe(2);
    });
  });

  describe('resend', () => {
    it('marks the row unread and pending, then pushes it again', async () => {
      getOne.mockResolvedValue({ id: 'n1', userId: U1, campaignId: null, type: 'general', title: 'Hi', body: '', link: null, image: null });
      expect(await service().resend('n1')).toBe(true);

      expect(update.mock.calls[0]).toEqual([{ id: 'n1' }, { readAt: null, pushStatus: NotificationPushStatus.PENDING, pushError: null }]);
      expect(statusUpdates().slice(1)).toEqual([[['n1'], NotificationPushStatus.SKIPPED, 'Push is not configured (FIREBASE_SERVICE_ACCOUNT_JSON)']]);
    });

    it('says so when the notification does not exist', async () => {
      expect(await service().resend('missing')).toBe(false);
      expect(update).not.toHaveBeenCalled();
    });
  });

  it('needs a title', async () => {
    await expect(service().send([U1], { title: '  ' })).rejects.toThrow('A notification needs a title');
  });
});
