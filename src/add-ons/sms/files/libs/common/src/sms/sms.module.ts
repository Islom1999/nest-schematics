import { Global, Module } from '@nestjs/common';
import { SmsService } from './sms.service';

/** `SmsService` for every module (global). Added by `npm run g -- sms`. */
@Global()
@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
