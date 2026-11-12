import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogMailTransport } from './log-mail.transport';
import { MAIL_TRANSPORTS } from './mail.transports';
import { MailMessage, MailTransport } from './mail.types';

/**
 * Sends email through the provider named by MAIL_PROVIDER (`npm run g -- mail resend|smtp|log`).
 *
 * The project boots without mail settings. When the chosen provider is not
 * configured, outside production it falls back to the `log` transport with a
 * warning; in production nothing is sent and `send()` fails with 503, so reset
 * codes never end up in production logs.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transport: MailTransport | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM')?.trim() || 'no-reply@example.com';
    const production = config.get<string>('NODE_ENV') === 'production';
    const wanted = (config.get<string>('MAIL_PROVIDER') ?? '').trim().toLowerCase() || 'log';
    const factory = MAIL_TRANSPORTS[wanted];
    let transport: MailTransport | null = null;
    if (!factory) {
      this.logger.error(
        `MAIL_PROVIDER="${wanted}" is not installed (installed: ${Object.keys(MAIL_TRANSPORTS).join(', ')}); ` +
          `run "npm run g -- mail ${wanted}".`,
      );
    } else {
      transport = factory(config);
      if (!transport) this.logger.warn(`MAIL_PROVIDER="${wanted}" is not configured: set its keys in .env.`);
    }

    if (production && (!transport || transport.name === 'log')) {
      this.logger.error('Email is disabled: set MAIL_PROVIDER and its keys (the log transport is not used in production).');
      transport = null;
    } else if (!transport) {
      this.logger.warn('Emails are written to the server log instead (development only).');
      transport = new LogMailTransport();
    }
    this.transport = transport;
  }

  /** Name of the active transport, or null when email is disabled. */
  get provider(): string | null {
    return this.transport?.name ?? null;
  }

  async send(message: MailMessage): Promise<void> {
    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    if (!recipients.length || recipients.some((r) => !r || !r.includes('@'))) {
      throw new BadRequestException('Invalid email recipient');
    }
    if (!message.html && !message.text) throw new BadRequestException('An email needs html or text');
    if (!this.transport) throw new ServiceUnavailableException('Email sending is not configured');
    try {
      await this.transport.send({ ...message, from: message.from ?? this.from });
    } catch (error) {
      this.logger.error(`Email "${message.subject}" via ${this.transport.name} failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Could not send the email, try again later');
    }
  }
}
