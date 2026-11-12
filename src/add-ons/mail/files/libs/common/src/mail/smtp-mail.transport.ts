import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { MailMessage, MailTransport } from './mail.types';

/**
 * Any SMTP server through nodemailer: SMTP_HOST, SMTP_PORT (587 STARTTLS,
 * 465 with SMTP_SECURE=true), SMTP_USER, SMTP_PASSWORD. The connection is
 * opened on the first message, not at boot.
 */
export class SmtpMailTransport implements MailTransport {
  readonly name = 'smtp';

  constructor(private readonly transporter: Transporter) {}

  /** Null when SMTP_HOST is missing. */
  static fromConfig(config: ConfigService): SmtpMailTransport | null {
    const host = config.get<string>('SMTP_HOST')?.trim();
    if (!host) return null;
    const user = config.get<string>('SMTP_USER')?.trim();
    const secure = ['true', '1'].includes((config.get<string>('SMTP_SECURE') ?? '').trim());
    return new SmtpMailTransport(
      createTransport({
        host,
        port: Number(config.get('SMTP_PORT') || (secure ? 465 : 587)),
        secure,
        auth: user ? { user, pass: config.get<string>('SMTP_PASSWORD') ?? '' } : undefined,
        connectionTimeout: 10_000,
      }),
    );
  }

  async send(message: MailMessage & { from: string }): Promise<void> {
    await this.transporter.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });
  }
}
