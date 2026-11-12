import { BadRequestException, ConflictException, HttpException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { codeMail, DeviceInfo, hashPassword, LoginAttemptLimiter, MailService, verifyPassword } from '@app/common';
import { normalizeEmail, User } from '@app/database';
import { ClientAuthService } from '../client-auth.service';
import { isUniqueViolation } from '../client-auth.types';
import { ClientAuthResponseDto } from '../dto/client-auth.dto';
import { OtpService, RESET_OTP_POLICY } from '../otp.service';
import { UserSessionsService } from '../user-sessions.service';

/**
 * Email + password accounts: sign-up, sign-in, and password reset with a
 * 6-digit code sent by email (MailService). Forgot-password answers the same
 * whether the account exists or not.
 *
 * Brute force: 5 failed sign-ins (or reset codes) per email + IP in 15 minutes
 * lock that pair; per-email code limits live in the database.
 */
@Injectable()
export class EmailAuthService {
  private readonly logger = new Logger('EmailAuth');
  private readonly attempts = new LoginAttemptLimiter(5, 15 * 60_000);
  private readonly resetRequestsPerIp = new LoginAttemptLimiter(20, 60 * 60_000);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly otp: OtpService,
    private readonly mail: MailService,
    private readonly auth: ClientAuthService,
    private readonly sessions: UserSessionsService,
  ) {}

  async signUp(email: string, password: string, name: string | undefined, device: DeviceInfo): Promise<ClientAuthResponseDto> {
    const normalized = normalizeEmail(email);
    if (await this.users.exists({ where: { email: normalized } })) {
      throw new ConflictException('An account with this email already exists');
    }
    let user: User;
    try {
      user = await this.users.save(
        this.users.create({ email: normalized, passwordHash: await hashPassword(password), name: name ?? '' }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('An account with this email already exists');
      throw error;
    }
    return this.auth.startSession(user, device, true);
  }

  async signIn(email: string, password: string, device: DeviceInfo): Promise<ClientAuthResponseDto> {
    const normalized = normalizeEmail(email);
    const key = `${normalized}|${device.ip}`;
    this.attempts.assertAllowed(key);
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: normalized })
      .getOne();
    const valid = await verifyPassword(user?.passwordHash, password);
    if (!user || !valid) {
      this.attempts.fail(key);
      throw new UnauthorizedException('Invalid email or password');
    }
    this.attempts.reset(key);
    return this.auth.startSession(user, device);
  }

  /** Emails a reset code when the account exists; the answer never tells. */
  async forgotPassword(email: string, device: DeviceInfo): Promise<void> {
    const normalized = normalizeEmail(email);
    this.resetRequestsPerIp.assertAllowed(device.ip);
    this.resetRequestsPerIp.fail(device.ip);
    const user = await this.users.findOne({ where: { email: normalized } });
    if (!user || user.isBlocked) return;
    let code: string;
    try {
      code = await this.otp.issue('password_reset', normalized, device.ip, RESET_OTP_POLICY);
    } catch (error) {
      // A per-email limit would reveal that the account exists: stay silent.
      if (error instanceof HttpException && error.getStatus() === 429) return;
      throw error;
    }
    const minutes = RESET_OTP_POLICY.ttlMs / 60_000;
    try {
      await this.mail.send({
        to: normalized,
        ...codeMail({
          subject: 'Password reset code',
          title: 'Reset your password',
          intro: 'Use this code to set a new password:',
          code,
          expiresInMinutes: minutes,
        }),
      });
    } catch {
      this.logger.error('Could not send a password reset email');
    }
  }

  /** Checks the emailed code, sets the new password and ends every session. */
  async resetPassword(email: string, code: string, newPassword: string, device: DeviceInfo): Promise<void> {
    const normalized = normalizeEmail(email);
    const key = `reset|${normalized}|${device.ip}`;
    this.attempts.assertAllowed(key);
    const user = await this.users.findOne({ where: { email: normalized } });
    if (!user || !(await this.otp.verify('password_reset', normalized, code, RESET_OTP_POLICY))) {
      this.attempts.fail(key);
      throw new BadRequestException('Invalid or expired code');
    }
    this.attempts.reset(key);
    await this.users.update(user.id, { passwordHash: await hashPassword(newPassword), emailVerified: true });
    await this.sessions.revokeAll(user.id, 'password_changed');
    this.auth.invalidateUser(user.id);
  }
}
