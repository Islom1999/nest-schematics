import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';

/**
 * Telegraf bot skeleton. Starts only when BOT_TOKEN is set, so the rest of
 * the monorepo works without a bot. Add handlers in `registerHandlers`.
 */
@Injectable()
export class BotService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BotService.name);
  private bot?: Telegraf;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const token = this.config.get<string>('BOT_TOKEN');
    if (!token) {
      this.logger.warn('BOT_TOKEN is not set — bot is disabled');
      return;
    }
    this.bot = new Telegraf(token);
    this.registerHandlers(this.bot);
    // launch() resolves only when the bot stops, so it is not awaited.
    this.bot.launch().catch((e: Error) => this.logger.error(`Bot stopped: ${e.message}`, e.stack));
    this.logger.log('Bot launched (long polling)');
  }

  onApplicationShutdown(signal?: string) {
    this.bot?.stop(signal);
  }

  private registerHandlers(bot: Telegraf) {
    bot.start((ctx) => ctx.reply(`Salom, ${ctx.from.first_name}!`));
    bot.command('ping', (ctx) => ctx.reply('pong'));
  }
}
