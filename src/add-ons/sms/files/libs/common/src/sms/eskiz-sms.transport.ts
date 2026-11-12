import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsTransport } from './sms.types';

const ESKIZ_API = 'https://notify.eskiz.uz/api';
const TIMEOUT_MS = 10_000;

export interface EskizOptions {
  email: string;
  password: string;
  /** Sender name approved by Eskiz (default `4546`, the shared test sender). */
  from: string;
  /** Delivery report webhook (optional). */
  callbackUrl?: string;
}

/**
 * Eskiz.uz gateway. Logs in with ESKIZ_EMAIL / ESKIZ_PASSWORD on the first
 * message and keeps the token in memory; a 401 (expired token) logs in again
 * and retries once. Eskiz only delivers texts that match a template approved
 * in your cabinet (see USER_OTP_SMS_TEXT for the sign-in code text).
 */
export class EskizSmsTransport implements SmsTransport {
  readonly name = 'eskiz';
  private readonly logger = new Logger('Sms');
  private token: string | null = null;
  private login: Promise<string> | null = null;

  constructor(private readonly options: EskizOptions) {}

  /** Null when ESKIZ_EMAIL or ESKIZ_PASSWORD is missing. */
  static fromConfig(config: ConfigService): EskizSmsTransport | null {
    const email = config.get<string>('ESKIZ_EMAIL')?.trim();
    const password = config.get<string>('ESKIZ_PASSWORD')?.trim();
    if (!email || !password) return null;
    return new EskizSmsTransport({
      email,
      password,
      from: config.get<string>('ESKIZ_FROM')?.trim() || '4546',
      callbackUrl: config.get<string>('ESKIZ_CALLBACK_URL')?.trim() || undefined,
    });
  }

  async send(phone: string, text: string): Promise<void> {
    const form = new FormData();
    form.set('mobile_phone', phone.replace(/\D/g, ''));
    form.set('message', text);
    form.set('from', this.options.from);
    if (this.options.callbackUrl) form.set('callback_url', this.options.callbackUrl);

    let response = await this.post('/message/sms/send', form, await this.accessToken());
    if (response.status === 401) {
      this.token = null;
      response = await this.post('/message/sms/send', form, await this.accessToken());
    }
    if (!response.ok) {
      throw new Error(`Eskiz responded ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    // One login at a time, shared by concurrent sends.
    this.login ??= this.authenticate().finally(() => {
      this.login = null;
    });
    return this.login;
  }

  private async authenticate(): Promise<string> {
    const form = new FormData();
    form.set('email', this.options.email);
    form.set('password', this.options.password);
    const response = await this.post('/auth/login', form);
    if (!response.ok) {
      this.logger.error(`Eskiz login failed with ${response.status}: check ESKIZ_EMAIL / ESKIZ_PASSWORD`);
      throw new Error(`Eskiz login failed (${response.status})`);
    }
    const body = (await response.json()) as { data?: { token?: unknown } };
    const token = body.data?.token;
    if (typeof token !== 'string' || !token) throw new Error('Eskiz login returned no token');
    this.token = token;
    return token;
  }

  private post(path: string, body: FormData, token?: string): Promise<Response> {
    return fetch(`${ESKIZ_API}${path}`, {
      method: 'POST',
      body,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
}
