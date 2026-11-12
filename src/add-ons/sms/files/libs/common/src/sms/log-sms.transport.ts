import { Logger } from '@nestjs/common';
import { SmsTransport } from './sms.types';

/**
 * Development transport: writes the message to the server log instead of
 * sending it. SmsService never uses it in production.
 */
export class LogSmsTransport implements SmsTransport {
  readonly name = 'log';
  private readonly logger = new Logger('Sms');

  async send(phone: string, text: string): Promise<void> {
    this.logger.log(`[SMS_PROVIDER=log] SMS to ${phone}: ${text}`);
  }
}
