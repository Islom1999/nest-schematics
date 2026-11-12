import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BotModule } from './bot.module';

/** Telegram bot (long polling) — no HTTP server. */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(BotModule);
  app.enableShutdownHooks();
  Logger.log('Bot app started', 'Bootstrap');
}

void bootstrap();
