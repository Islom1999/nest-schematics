import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** `MailService` for every module (global). Added by `npm run g -- mail`. */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
