import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogSmsTransport } from './log-sms.transport';
import { maskPhone, normalizePhone } from './phone';
import { SMS_TRANSPORTS } from './sms.transports';
import { SmsTransport } from './sms.types';

/**
 * Sends SMS through the gateway named by SMS_PROVIDER (`npm run g -- sms eskiz|log`).
 *
 * The project boots without SMS settings. When the chosen gateway is not
 * configured, outside production it falls back to the `log` transport (the
 * text goes to the server log) with a warning; in production nothing is sent
 * and `send()` fails with 503, so codes never end up in production logs.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger('Sms');
  private readonly transport: SmsTransport | null;

  constructor(config: ConfigService) {
    const production = config.get<string>('NODE_ENV') === 'production';
    const wanted = (config.get<string>('SMS_PROVIDER') ?? '').trim().toLowerCase() || 'log';
    const factory = SMS_TRANSPORTS[wanted];
    let transport: SmsTransport | null = null;
    if (!factory) {
      this.logger.error(
        `SMS_PROVIDER="${wanted}" is not installed (installed: ${Object.keys(SMS_TRANSPORTS).join(', ')}); ` +
          `run "npm run g -- sms ${wanted}".`,
      );
    } else {
      transport = factory(config);
      if (!transport) this.logger.warn(`SMS_PROVIDER="${wanted}" is not configured: set its keys in .env.`);
    }

    if (production && (!transport || transport.name === 'log')) {
      this.logger.error('SMS is disabled: set SMS_PROVIDER and its keys (the log transport is not used in production).');
      transport = null;
    } else if (!transport) {
      this.logger.warn('SMS messages are written to the server log instead (development only).');
      transport = new LogSmsTransport();
    }
    this.transport = transport;
  }

  /** Name of the active transport, or null when SMS is disabled. */
  get provider(): string | null {
    return this.transport?.name ?? null;
  }

  /** Sends `text` to `phone` (any common format; normalised to E.164). */
  async send(phone: string, text: string): Promise<void> {
    const to = normalizePhone(phone);
    if (!to) throw new BadRequestException('Invalid phone number');
    if (!this.transport) throw new ServiceUnavailableException('SMS sending is not configured');
    try {
      await this.transport.send(to, text);
    } catch (error) {
      this.logger.error(`SMS to ${maskPhone(to)} via ${this.transport.name} failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Could not send the SMS, try again later');
    }
  }
}
