import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiChatMessage, AiChatSession } from '@app/database';
import { AiChatController } from './ai-chat.controller';
import { AiChatService } from './ai-chat.service';
import { AiPromptsService } from './ai-prompts.service';

/**
 * AI chat for client users (`npm run g -- ai --chat`). Limits, when
 * installed (`--quota`), come from the global AiQuotaModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AiChatSession, AiChatMessage])],
  controllers: [AiChatController],
  providers: [AiChatService, AiPromptsService],
  exports: [AiChatService, AiPromptsService],
})
export class AiChatModule {}
