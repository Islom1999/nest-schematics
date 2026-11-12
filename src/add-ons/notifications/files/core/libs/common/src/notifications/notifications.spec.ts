import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Notification, NotificationCampaign, NotificationPushStatus, User } from '@app/database';
import { FCM_MULTICAST_LIMIT, FcmSender } from './fcm.sender';
import { parseServiceAccount } from './firebase-credentials';
import { NotificationService } from './notification.service';
import { PushTarget } from './notification.types';
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

  function service(values: Record<string, string> = {}): NotificationService {
    const qb = {
      select: () => qb,
      orderBy: () => qb,
      andWhere: () => qb,
      getRawMany: async () => [{ id: U1 }, { id: U2 }],
    };
    const store: PushTokenStore = { activePushTokens, clearPushToken };
    return new NotificationService(
      { insert, update } as unknown as Repository<Notification>,
      {} as Repository<NotificationCampaign>,
      { createQueryBuilder: () => qb } as unknown as Repository<User>,
      store,
      new FcmSender(config(values)),
      [],
      config(values),
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

  it('needs a title', async () => {
    await expect(service().send([U1], { title: '  ' })).rejects.toThrow('A notification needs a title');
  });
});
