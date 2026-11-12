import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { UserOtp } from '@app/database';
import { CLIENT_AUTH_OPTIONS, ClientAuthOptions } from './client-auth.config';

export type OtpPurpose = 'phone_sign_in' | 'password_reset';

export interface OtpPolicy {
  /** Code lifetime. */
  ttlMs: number;
  /** Minimum time between two codes for the same target. */
  resendMs: number;
  /** Codes per target per hour. */
  maxPerHour: number;
  /** Checks per code (right or wrong) before it is dropped. */
  maxAttempts: number;
}

export const PHONE_OTP_POLICY: OtpPolicy = { ttlMs: 3 * 60_000, resendMs: 60_000, maxPerHour: 5, maxAttempts: 5 };
export const RESET_OTP_POLICY: OtpPolicy = { ttlMs: 15 * 60_000, resendMs: 60_000, maxPerHour: 5, maxAttempts: 5 };

const HOUR_MS = 60 * 60_000;

/**
 * 6-digit one-time codes in `user_otps`. Only an HMAC (keyed with a secret
 * derived from USER_JWT_SECRET) is stored, never the code. The newest code of
 * a target is the only valid one; it is single use and dropped after
 * `maxAttempts` checks. Per-target resend and hourly limits live in the
 * database, so they hold across API instances. Codes are never logged or
 * returned by the API.
 */
@Injectable()
export class OtpService {
  constructor(
    @InjectRepository(UserOtp) private readonly codes: Repository<UserOtp>,
    @Inject(CLIENT_AUTH_OPTIONS) private readonly options: ClientAuthOptions,
  ) {}

  /** Creates a code for `target` and returns it for sending. 429 while a limit applies. */
  async issue(purpose: OtpPurpose, target: string, ip: string, policy: OtpPolicy): Promise<string> {
    const now = Date.now();
    const recent = await this.codes.find({
      select: { id: true, createdAt: true },
      where: { purpose, target, createdAt: MoreThan(new Date(now - HOUR_MS)) },
      order: { createdAt: 'DESC' },
    });
    const last = recent[0]?.createdAt.getTime();
    if (last !== undefined && now - last < policy.resendMs) {
      const wait = Math.ceil((policy.resendMs - (now - last)) / 1000);
      throw new HttpException(`Please wait ${wait} s before requesting a new code`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (recent.length >= policy.maxPerHour) {
      throw new HttpException('Too many codes requested. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    // Only the newest code stays valid.
    await this.codes.update({ purpose, target, consumedAt: IsNull() }, { consumedAt: new Date(now) });
    await this.codes.insert({
      purpose,
      target,
      codeHash: this.hash(purpose, target, code),
      expiresAt: new Date(now + policy.ttlMs),
      ip: ip.slice(0, 64),
    });
    await this.codes.delete({ expiresAt: LessThan(new Date(now - 24 * HOUR_MS)) });
    return code;
  }

  /**
   * True when `code` is the live code of `target`; it is consumed then. Every
   * check uses up one attempt, so guessing stops after `maxAttempts`.
   */
  async verify(purpose: OtpPurpose, target: string, code: string, policy: OtpPolicy): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const row = await this.codes.findOne({
      where: { purpose, target, consumedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC' },
    });
    if (!row) return false;

    // Reserve an attempt atomically: concurrent guesses cannot exceed the limit.
    const reserved = await this.codes
      .createQueryBuilder()
      .update()
      .set({ attempts: () => 'attempts + 1' })
      .where('id = :id AND attempts < :max AND consumed_at IS NULL', { id: row.id, max: policy.maxAttempts })
      .execute();
    if (!reserved.affected) return false;

    const expected = Buffer.from(row.codeHash, 'hex');
    const actual = Buffer.from(this.hash(purpose, target, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

    // Single use: of two requests with the right code only one wins.
    const consumed = await this.codes.update({ id: row.id, consumedAt: IsNull() }, { consumedAt: new Date() });
    return !!consumed.affected;
  }

  private hash(purpose: OtpPurpose, target: string, code: string): string {
    return createHmac('sha256', this.options.otpKey).update(`${purpose}:${target}:${code}`).digest('hex');
  }
}
