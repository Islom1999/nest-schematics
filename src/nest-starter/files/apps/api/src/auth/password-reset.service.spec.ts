import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminMailer, PasswordResetMail, sha256 } from '@app/common';
import { AdminSessionsService } from './admin-sessions.service';
import { PasswordResetService } from './password-reset.service';

const ADMIN = { id: 'admin-1', email: 'boss@example.com', name: 'Boss', isBlocked: false };

function setup(options: { admin?: object | null; recent?: boolean; production?: boolean; mailer?: AdminMailer | null } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const queryBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ raw: [{ admin_id: ADMIN.id }] }),
  };
  const manager = {
    update: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn(async (_entity: unknown, row: Record<string, unknown>) => void inserted.push(row)),
    findOne: jest.fn().mockResolvedValue(ADMIN),
    createQueryBuilder: jest.fn(() => queryBuilder),
  };
  const admins = { findOne: jest.fn().mockResolvedValue(options.admin === undefined ? ADMIN : options.admin) };
  const resets = {
    exists: jest.fn().mockResolvedValue(options.recent ?? false),
    manager: { transaction: jest.fn(async (run: (m: typeof manager) => unknown) => run(manager)) },
  };
  const sessions = { revokeAll: jest.fn().mockResolvedValue(2) };
  const mailer = options.mailer === undefined ? { sendPasswordReset: jest.fn().mockResolvedValue(undefined) } : options.mailer;
  const config = {
    get: (key: string) => ({ NODE_ENV: options.production ? 'production' : 'test', ADMIN_APP_URL: 'https://admin.example.com/' })[key],
  } as unknown as ConfigService;
  const service = new PasswordResetService(
    admins as never,
    resets as never,
    sessions as unknown as AdminSessionsService,
    config,
    mailer as AdminMailer | undefined,
  );
  return { service, admins, resets, manager, queryBuilder, sessions, mailer, inserted };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('PasswordResetService.forgot', () => {
  it('does nothing for an unknown email (the route still answers 204)', async () => {
    const { service, resets, mailer } = setup({ admin: null });
    await expect(service.forgot('nobody@example.com')).resolves.toBeUndefined();
    expect(resets.manager.transaction).not.toHaveBeenCalled();
    expect((mailer as { sendPasswordReset: jest.Mock }).sendPasswordReset).not.toHaveBeenCalled();
  });

  it('does nothing for a blocked admin', async () => {
    const { service, resets } = setup({ admin: { ...ADMIN, isBlocked: true } });
    await service.forgot(ADMIN.email);
    expect(resets.manager.transaction).not.toHaveBeenCalled();
  });

  it('stores only the sha256 of the token, 30 minutes ahead, and mails the token once', async () => {
    const { service, inserted, mailer } = setup();
    const before = Date.now();
    await service.forgot('Boss@Example.com');
    await flush();

    const send = (mailer as { sendPasswordReset: jest.Mock }).sendPasswordReset;
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0] as PasswordResetMail;
    expect(mail.to).toBe(ADMIN.email);
    expect(mail.resetUrl).toBe(`https://admin.example.com/reset-password?token=${encodeURIComponent(mail.token)}`);
    expect(mail.expiresInMinutes).toBe(30);
    expect(mail.token.length).toBeGreaterThanOrEqual(43);

    expect(inserted).toHaveLength(1);
    expect(inserted[0].tokenHash).toBe(sha256(mail.token));
    expect(JSON.stringify(inserted[0])).not.toContain(mail.token);
    const ttl = (inserted[0].expiresAt as Date).getTime() - before;
    expect(ttl).toBeGreaterThan(29 * 60_000);
    expect(ttl).toBeLessThanOrEqual(30 * 60_000 + 5_000);
  });

  it('voids the older tokens of the admin in the same transaction', async () => {
    const { service, manager } = setup();
    await service.forgot(ADMIN.email);
    expect(manager.update).toHaveBeenCalledTimes(1);
    expect(manager.update.mock.calls[0][1]).toMatchObject({ adminId: ADMIN.id });
    expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(manager.insert.mock.invocationCallOrder[0]);
  });

  it('sends at most one email per minute per admin', async () => {
    const { service, resets, mailer } = setup({ recent: true });
    await service.forgot(ADMIN.email);
    await flush();
    expect(resets.manager.transaction).not.toHaveBeenCalled();
    expect((mailer as { sendPasswordReset: jest.Mock }).sendPasswordReset).not.toHaveBeenCalled();
  });

  it('without the mail add-on logs a warning; the link only outside production', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const dev = setup({ mailer: null });
      await dev.service.forgot(ADMIN.email);
      await flush();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('/reset-password?token=');

      warn.mockClear();
      const prod = setup({ mailer: null, production: true });
      await prod.service.forgot(ADMIN.email);
      await flush();
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain('no mail is set up');
      expect(line).not.toContain('token=');
      expect(line).not.toContain(String(prod.inserted[0].tokenHash));
    } finally {
      warn.mockRestore();
    }
  });

  it('a failing mailer never reaches the caller', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const { service } = setup({ mailer: { sendPasswordReset: jest.fn().mockRejectedValue(new Error('smtp down')) } });
      await expect(service.forgot(ADMIN.email)).resolves.toBeUndefined();
      await flush();
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe('PasswordResetService.reset', () => {
  it('consumes a live token by its hash, sets the password and ends every session', async () => {
    const { service, queryBuilder, manager, sessions } = setup();
    await service.reset('the-token', 'NewPassw0rd!');

    expect(queryBuilder.where.mock.calls[0][0]).toContain('used_at IS NULL');
    expect(queryBuilder.where.mock.calls[0][0]).toContain('expires_at > now()');
    expect(queryBuilder.where.mock.calls[0][1]).toEqual({ hash: sha256('the-token') });
    const passwordUpdate = manager.update.mock.calls.find(([, id]) => id === ADMIN.id);
    expect(passwordUpdate?.[2].passwordHash).toMatch(/^\$argon2id\$/);
    expect(sessions.revokeAll).toHaveBeenCalledWith(ADMIN.id, 'password_reset');
  });

  it('refuses a used, expired or unknown token (nothing matched) without touching sessions', async () => {
    const { service, queryBuilder, manager, sessions } = setup();
    queryBuilder.execute.mockResolvedValue({ raw: [] });
    await expect(service.reset('spent', 'NewPassw0rd!')).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
    expect(sessions.revokeAll).not.toHaveBeenCalled();
  });

  it('refuses a blocked admin', async () => {
    const { service, manager, sessions } = setup();
    manager.findOne.mockResolvedValue({ ...ADMIN, isBlocked: true });
    await expect(service.reset('t', 'NewPassw0rd!')).rejects.toBeInstanceOf(BadRequestException);
    expect(sessions.revokeAll).not.toHaveBeenCalled();
  });
});
