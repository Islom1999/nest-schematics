import { Logger } from '@nestjs/common';
import { MailMessage, MailTransport } from './mail.types';

/**
 * Development transport: writes the email (recipients, subject, text) to the
 * server log instead of sending it. MailService never uses it in production.
 */
export class LogMailTransport implements MailTransport {
  readonly name = 'log';
  private readonly logger = new Logger('Mail');

  async send(message: MailMessage & { from: string }): Promise<void> {
    const to = Array.isArray(message.to) ? message.to.join(', ') : message.to;
    const body = message.text ?? message.html ?? '';
    this.logger.log(`[MAIL_PROVIDER=log] Email to ${to}: "${message.subject}"\n${body}`);
  }
}
