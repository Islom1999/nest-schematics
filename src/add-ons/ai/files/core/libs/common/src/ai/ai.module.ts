import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiLog } from '@app/database';
import { AiLogService } from './ai-log.service';
import { AI_PROVIDERS, AiService } from './ai.service';
import { AiSettings } from './ai.settings';
import { AiProvider } from './ai.types';
import { AI_PROVIDER_CLASSES } from './providers';

/**
 * AiService for every module of the app (global). Providers only call out
 * when a request is made, so nothing connects on boot or during
 * `npm run swagger:export`.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AiLog])],
  providers: [
    AiSettings,
    AiLogService,
    ...AI_PROVIDER_CLASSES,
    {
      provide: AI_PROVIDERS,
      useFactory: (...providers: AiProvider[]) => providers,
      inject: AI_PROVIDER_CLASSES,
    },
    AiService,
  ],
  exports: [AiService, AiSettings],
})
export class AiModule {}
