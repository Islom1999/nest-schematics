import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceInfo } from '@app/common';
import { User } from '@app/database';
import { ClientAuthService } from '../client-auth.service';
import { isUniqueViolation } from '../client-auth.types';
import { ClientAuthResponseDto } from '../dto/client-auth.dto';
import { TelegramWebAppDto, TelegramWidgetDto } from './telegram-auth.dto';

const DEFAULT_MAX_AGE_SECONDS = 3600;

interface TelegramIdentity {
  id: string;
  name: string;
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === 32 && left.length === right.length && timingSafeEqual(left, right);
}

function displayName(first: unknown, last: unknown, username: unknown): string {
  const parts = [first, last].filter((part): part is string => typeof part === 'string' && part.trim() !== '');
  const name = parts.join(' ').trim() || (typeof username === 'string' ? username : '');
  return name.slice(0, 120);
}

/**
 * Telegram sign-in without the bot polling flow:
 * - Login Widget (web): the widget's signed object; key = SHA-256(BOT_TOKEN),
 *   hash = HMAC-SHA256 of the sorted `key=value` lines.
 * - Mini App: `Telegram.WebApp.initData`; key = HMAC-SHA256("WebAppData", BOT_TOKEN).
 * Both must be fresh: `auth_date` within TELEGRAM_AUTH_MAX_AGE seconds (default 1h).
 */
@Injectable()
export class TelegramAuthService {
  private readonly botToken: string;
  private readonly maxAgeSeconds: number;

  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly auth: ClientAuthService,
  ) {
    this.botToken = config.get<string>('BOT_TOKEN')?.trim() ?? '';
    const maxAge = Number(config.get<string | number>('TELEGRAM_AUTH_MAX_AGE'));
    this.maxAgeSeconds = Number.isFinite(maxAge) && maxAge > 0 ? maxAge : DEFAULT_MAX_AGE_SECONDS;
  }

  async signInWithWidget(dto: TelegramWidgetDto, device: DeviceInfo): Promise<ClientAuthResponseDto> {
    const fields: Record<string, string> = { id: String(dto.id), auth_date: String(dto.auth_date) };
    if (dto.first_name !== undefined) fields.first_name = dto.first_name;
    if (dto.last_name !== undefined) fields.last_name = dto.last_name;
    if (dto.username !== undefined) fields.username = dto.username;
    if (dto.photo_url !== undefined) fields.photo_url = dto.photo_url;
    const secret = createHash('sha256').update(this.token()).digest();
    this.check(fields, dto.hash, secret);
    this.checkFresh(dto.auth_date);
    return this.signIn({ id: String(dto.id), name: displayName(dto.first_name, dto.last_name, dto.username) }, device);
  }

  async signInWithWebApp(dto: TelegramWebAppDto, device: DeviceInfo): Promise<ClientAuthResponseDto> {
    const params = new URLSearchParams(dto.initData);
    const hash = params.get('hash') ?? '';
    const fields: Record<string, string> = {};
    params.forEach((value, key) => {
      if (key !== 'hash') fields[key] = value;
    });
    const secret = createHmac('sha256', 'WebAppData').update(this.token()).digest();
    this.check(fields, hash, secret);
    this.checkFresh(Number(fields.auth_date));

    let user: unknown;
    try {
      user = JSON.parse(fields.user ?? '');
    } catch {
      throw new UnauthorizedException('Invalid Telegram data');
    }
    const record = (user ?? {}) as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      throw new UnauthorizedException('Invalid Telegram data');
    }
    return this.signIn({ id: String(id), name: displayName(record.first_name, record.last_name, record.username) }, device);
  }

  private async signIn(identity: TelegramIdentity, device: DeviceInfo): Promise<ClientAuthResponseDto> {
    const existing = await this.users.findOne({ where: { telegramId: identity.id } });
    if (existing) return this.auth.startSession(existing, device);
    try {
      const user = await this.users.save(this.users.create({ telegramId: identity.id, name: identity.name }));
      return await this.auth.startSession(user, device, true);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const user = await this.users.findOneOrFail({ where: { telegramId: identity.id } });
      return this.auth.startSession(user, device);
    }
  }

  private token(): string {
    if (!this.botToken) throw new ServiceUnavailableException('Telegram sign-in is not configured (set BOT_TOKEN)');
    return this.botToken;
  }

  private check(fields: Record<string, string>, hash: string, secret: Buffer): void {
    const dataCheckString = Object.keys(fields)
      .sort()
      .map((key) => `${key}=${fields[key]}`)
      .join('\n');
    const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (!/^[0-9a-f]{64}$/.test(hash) || !safeEqualHex(expected, hash)) {
      throw new UnauthorizedException('Invalid Telegram data');
    }
  }

  private checkFresh(authDate: number): void {
    const age = Date.now() / 1000 - authDate;
    if (!Number.isFinite(authDate) || age > this.maxAgeSeconds || age < -60) {
      throw new UnauthorizedException('Telegram sign-in expired, please sign in again');
    }
  }
}
