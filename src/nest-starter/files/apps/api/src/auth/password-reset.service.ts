import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { ADMIN_MAILER, AdminMailer, hashPassword, randomToken, sha256 } from '@app/common';
import { Admin, AdminPasswordReset, normalizeEmail } from '@app/database';
import { AdminSessionsService } from './admin-sessions.service';

/** How long a reset token works. */
export const RESET_TOKEN_TTL_MIN = 30;
/** At most one reset email per admin in this window (the request still answers 204). */
const RESET_COOLDOWN_MS = 60_000;
const DEFAULT_ADMIN_APP_URL = 'http://localhost:4200';

/**
 * Forgot / reset password of an admin.
 *
 * - `forgot` never reveals whether the email belongs to an admin: it always
 *   completes the same way, and the mail is sent after the work is done
 *   without waiting for it (response time does not show the difference).
 * - The token is 256 random bits; only its sha256 is stored. It is single use
 *   (`used_at`) and expires after 30 minutes; a new request voids the older ones.
 * - `reset` consumes the token and sets the password in one transaction, then
 *   ends every session of the admin.
 * - The token goes out through the `AdminMailer` port (the mail add-on). Without
 *   it a warning is logged; the link (with the token) only outside production.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger('PasswordReset');
  private readonly production: boolean;
  private readonly appUrl: string;

  constructor(
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
    @InjectRepository(AdminPasswordReset) private readonly resets: Repository<AdminPasswordReset>,
    private readonly sessions: AdminSessionsService,
    config: ConfigService,
    @Optional() @Inject(ADMIN_MAILER) private readonly mailer?: AdminMailer,
  ) {
    this.production = config.get<string>('NODE_ENV') === 'production';
    this.appUrl = (config.get<string>('ADMIN_APP_URL')?.trim() || DEFAULT_ADMIN_APP_URL).replace(/\/+$/, '');
  }

  async forgot(email: string): Promise<void> {
    const admin = await this.admins.findOne({ where: { email: normalizeEmail(email) } });
    if (!admin || admin.isBlocked) return;
    const recent = await this.resets.exists({
      where: { adminId: admin.id, createdAt: MoreThan(new Date(Date.now() - RESET_COOLDOWN_MS)) },
    });
    if (recent) return;

    const token = randomToken(32);
    await this.resets.manager.transaction(async (manager) => {
      await manager.update(AdminPasswordReset, { adminId: admin.id, usedAt: IsNull() }, { usedAt: new Date() });
      await manager.insert(AdminPasswordReset, {
        adminId: admin.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60_000),
      });
    });
    void this.deliver(admin, token).catch((error: Error) =>
      this.logger.error(`Could not deliver the reset email of admin ${admin.id}: ${error.message}`),
    );
  }

  async reset(token: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    const adminId = await this.resets.manager.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(AdminPasswordReset)
        .set({ usedAt: new Date() })
        .where('token_hash = :hash AND used_at IS NULL AND expires_at > now() AND deleted_at IS NULL', {
          hash: sha256(token),
        })
        .returning('admin_id')
        .execute();
      const id = (result.raw as { admin_id: string }[])[0]?.admin_id;
      if (!id) return null;
      const admin = await manager.findOne(Admin, { where: { id } });
      if (!admin || admin.isBlocked) return null;
      await manager.update(Admin, id, { passwordHash });
      await manager.update(AdminPasswordReset, { adminId: id, usedAt: IsNull() }, { usedAt: new Date() });
      return id;
    });
    if (!adminId) throw new BadRequestException('Invalid or expired token');
    await this.sessions.revokeAll(adminId, 'password_reset');
  }

  private async deliver(admin: Admin, token: string): Promise<void> {
    const resetUrl = `${this.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    if (this.mailer) {
      await this.mailer.sendPasswordReset({
        to: admin.email,
        name: admin.name,
        token,
        resetUrl,
        expiresInMinutes: RESET_TOKEN_TTL_MIN,
      });
      return;
    }
    this.logger.warn(
      `Password reset requested for admin ${admin.id}, but no mail is set up (npm run g -- mail resend|smtp), so nothing was sent.` +
        (this.production ? '' : ` Development only, the reset link: ${resetUrl}`),
    );
  }
}
