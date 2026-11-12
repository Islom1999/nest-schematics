import { Injectable } from '@nestjs/common';
import { AdminMailer, PasswordResetMail } from '../auth/admin-mailer';
import { MailService } from './mail.service';
import { actionMail } from './mail.templates';

/**
 * The starter's `AdminMailer` port on top of MailService: sends the admin
 * password-reset link. MailModule provides it as `ADMIN_MAILER`, so admin
 * auth uses it as soon as the mail add-on is installed (any install order).
 */
@Injectable()
export class MailAdminMailer implements AdminMailer {
  constructor(private readonly mail: MailService) {}

  async sendPasswordReset(input: PasswordResetMail): Promise<void> {
    const rendered = actionMail({
      subject: 'Reset your admin password',
      title: 'Reset your password',
      intro: `${input.name ? `Hi ${input.name}, ` : ''}we got a request to reset the password of your admin account. The link works for ${input.expiresInMinutes} minutes and only once.`,
      actionText: 'Choose a new password',
      actionUrl: input.resetUrl,
      outro: 'If you did not ask for this, you can ignore this email: your password stays as it is.',
    });
    await this.mail.send({ to: input.to, ...rendered });
  }
}
