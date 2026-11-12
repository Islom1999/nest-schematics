import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@app/database';
import { MailService } from '../../mail';
import { absoluteLink, escapeHtml, NotificationChannel } from '../notification-channel';
import { NotificationPayload } from '../notification.types';

/**
 * Emails notifications to users with an email address, through the mail
 * add-on's MailService (MAIL_PROVIDER). One message per user, so addresses
 * are never shared. Added by `npm run g -- notifications --channels email`.
 */
@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly name = 'email';
  private readonly logger = new Logger('EmailChannel');

  constructor(
    private readonly mail: MailService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async deliver(userIds: string[], payload: NotificationPayload): Promise<void> {
    if (!userIds.length) return;
    const rows = await this.users
      .createQueryBuilder('user')
      .select(['user.id', 'user.email'])
      .where('user.id IN (:...ids)', { ids: userIds })
      .andWhere('user.email IS NOT NULL')
      .getMany();
    const link = absoluteLink(payload.link);
    const text = [payload.body ?? '', link ?? ''].filter(Boolean).join('\n\n');
    const html = [
      `<h2>${escapeHtml(payload.title)}</h2>`,
      payload.body ? `<p>${escapeHtml(payload.body).replace(/\n/g, '<br>')}</p>` : '',
      link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` : '',
    ].join('');
    let sent = 0;
    for (const row of rows) {
      if (!row.email) continue;
      try {
        await this.mail.send({ to: row.email, subject: payload.title, text: text || payload.title, html });
        sent++;
      } catch (error) {
        this.logger.warn(`Notification email to user ${row.id} failed: ${(error as Error).message}`);
      }
    }
    if (rows.length) this.logger.log(`Email: ${sent}/${rows.length} sent`);
  }
}
