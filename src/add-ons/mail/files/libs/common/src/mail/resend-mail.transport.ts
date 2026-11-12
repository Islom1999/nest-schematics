import { ConfigService } from '@nestjs/config';
import { MailMessage, MailTransport } from './mail.types';

const RESEND_API = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/** Resend (resend.com) over its HTTP API. Needs RESEND_API_KEY and a verified MAIL_FROM domain. */
export class ResendMailTransport implements MailTransport {
  readonly name = 'resend';

  constructor(private readonly apiKey: string) {}

  /** Null when RESEND_API_KEY is missing. */
  static fromConfig(config: ConfigService): ResendMailTransport | null {
    const key = config.get<string>('RESEND_API_KEY')?.trim();
    return key ? new ResendMailTransport(key) : null;
  }

  async send(message: MailMessage & { from: string }): Promise<void> {
    const response = await fetch(RESEND_API, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: message.from,
        to: Array.isArray(message.to) ? message.to : [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: message.replyTo,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Resend responded ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
  }
}
