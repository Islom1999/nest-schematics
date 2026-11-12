import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiUsageDaily, AiUsageMonthly } from '@app/database';
import { AI_CHAT_QUOTA } from '../chat/ai-chat.quota';
import { AiQuotaService } from './ai-quota.service';
import { AiAdminQuotaController } from './ai-usage-admin.controller';
import { AiUsageAdminService } from './ai-usage-admin.service';
import { AiUsageController } from './ai-usage.controller';

/**
 * AI chat limits (`npm run g -- ai --quota`). Global so AiChatService picks
 * up AI_CHAT_QUOTA without importing this module.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AiUsageDaily, AiUsageMonthly])],
  controllers: [AiUsageController, AiAdminQuotaController],
  providers: [AiQuotaService, AiUsageAdminService, { provide: AI_CHAT_QUOTA, useExisting: AiQuotaService }],
  exports: [AiQuotaService, AI_CHAT_QUOTA],
})
export class AiQuotaModule {}
