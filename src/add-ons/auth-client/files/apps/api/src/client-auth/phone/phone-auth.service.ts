import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceInfo, LoginAttemptLimiter, normalizePhone, SmsService } from '@app/common';
import { User } from '@app/database';
import { ClientAuthService } from '../client-auth.service';
import { isUniqueViolation } from '../client-auth.types';
import { ClientAuthResponseDto } from '../dto/client-auth.dto';
import { OtpService, PHONE_OTP_POLICY } from '../otp.service';
import { PhoneCodeSentDto } from './phone-auth.dto';

const DEFAULT_TEXT = 'Your verification code: {code}';

/**
 * Phone sign-in: a 6-digit SMS code (3 minutes, single use, 5 checks), then
 * the account is found or created by phone. No master code exists.
 *
 * Limits: per phone 1 code per minute and 5 per hour (database, all
 * instances); per IP 20 codes per hour and 10 wrong codes per 15 minutes (in
 * memory); `@AuthThrottle()` on the routes on top.
 */
@Injectable()
export class PhoneAuthService {
  private readonly sendsPerIp = new LoginAttemptLimiter(20, 60 * 60_000);
  private readonly failuresPerIp = new LoginAttemptLimiter(10, 15 * 60_000);
  private readonly text: string;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly otp: OtpService,
    private readonly sms: SmsService,
    private readonly auth: ClientAuthService,
    config: ConfigService,
  ) {
    const text = config.get<string>('USER_OTP_SMS_TEXT')?.trim() || DEFAULT_TEXT;
    this.text = text.includes('{code}') ? text : `${text} {code}`;
  }

  async sendCode(rawPhone: string, device: DeviceInfo): Promise<PhoneCodeSentDto> {
    const phone = this.phone(rawPhone);
    this.sendsPerIp.assertAllowed(device.ip);
    const code = await this.otp.issue('phone_sign_in', phone, device.ip, PHONE_OTP_POLICY);
    this.sendsPerIp.fail(device.ip);
    await this.sms.send(phone, this.text.replace('{code}', code));
    return {
      success: true,
      expiresIn: PHONE_OTP_POLICY.ttlMs / 1000,
      resendIn: PHONE_OTP_POLICY.resendMs / 1000,
    };
  }

  async verify(rawPhone: string, code: string, device: DeviceInfo): Promise<ClientAuthResponseDto> {
    const phone = this.phone(rawPhone);
    this.failuresPerIp.assertAllowed(device.ip);
    if (!(await this.otp.verify('phone_sign_in', phone, code, PHONE_OTP_POLICY))) {
      this.failuresPerIp.fail(device.ip);
      throw new UnauthorizedException('Invalid or expired code');
    }

    let user = await this.users.findOne({ where: { phone } });
    let isNew = false;
    if (!user) {
      try {
        user = await this.users.save(this.users.create({ phone }));
        isNew = true;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        user = await this.users.findOneOrFail({ where: { phone } });
      }
    }
    return this.auth.startSession(user, device, isNew);
  }

  private phone(raw: string): string {
    const phone = normalizePhone(raw);
    if (!phone) throw new BadRequestException('Invalid phone number (use the international format, e.g. +998901234567)');
    return phone;
  }
}
