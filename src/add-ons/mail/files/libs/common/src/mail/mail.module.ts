import { Global, Module } from '@nestjs/common';
import { ADMIN_MAILER } from '../auth/admin-mailer';
import { MailAdminMailer } from './mail-admin-mailer';
import { MailService } from './mail.service';

/**
 * `MailService` for every module (global). Added by `npm run g -- mail`.
 * Also provides the admin auth's `ADMIN_MAILER` (password-reset email).
 */
@Global()
@Module({
  providers: [MailService, MailAdminMailer, { provide: ADMIN_MAILER, useExisting: MailAdminMailer }],
  exports: [MailService, ADMIN_MAILER],
})
export class MailModule {}
