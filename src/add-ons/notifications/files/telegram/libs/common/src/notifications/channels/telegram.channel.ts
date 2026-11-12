import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@app/database';
import { absoluteLink, escapeHtml, NotificationChannel } from '../notification-channel';
import { NotificationPayload } from '../notification.types';

/** Telegram allows about 30 messages per second per bot. */
const DELAY_MS = 40;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface TelegramResponse {
  ok: boolean;
  description?: string;
  parameters?: { retry_after?: number };
}

/**
 * Sends notifications to users who signed in with Telegram (`users.telegram_id`)
 * through the Bot API (`sendMessage`, BOT_TOKEN). Users must have started the
 * bot once; the ones who blocked it are skipped. Empty BOT_TOKEN = channel off.
 * Added by `npm run g -- notifications --channels telegram`.
 */
@Injectable()
export class TelegramChannel implements NotificationChannel {
  readonly name = 'telegram';
  private readonly logger = new Logger('TelegramChannel');
  private warned = false;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async deliver(userIds: string[], payload: NotificationPayload): Promise<void> {
    const token = this.config.get<string>('BOT_TOKEN')?.trim();
    if (!token) {
      if (!this.warned) this.logger.warn('BOT_TOKEN is not set: Telegram notifications are off.');
      this.warned = true;
      return;
    }
    if (!userIds.length) return;
    const rows = await this.users
      .createQueryBuilder('user')
      .select(['user.id', 'user.telegramId'])
      .where('user.id IN (:...ids)', { ids: userIds })
      .andWhere('user.telegramId IS NOT NULL')
      .getMany();
    const text = this.text(payload);
    let sent = 0;
    for (const row of rows) {
      if (!row.telegramId) continue;
      if (await this.sendMessage(token, row.telegramId, text)) sent++;
      await sleep(DELAY_MS);
    }
    if (rows.length) this.logger.log(`Telegram: ${sent}/${rows.length} sent`);
  }

  private text(payload: NotificationPayload): string {
    const lines = [`<b>${escapeHtml(payload.title)}</b>`];
    if (payload.body) lines.push(escapeHtml(payload.body));
    const link = absoluteLink(payload.link);
    if (link) lines.push(escapeHtml(link));
    return lines.join('\n').slice(0, 4096);
  }

  private async sendMessage(token: string, chatId: string, text: string, retry = true): Promise<boolean> {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return true;
      const result = (await response.json().catch(() => ({ ok: false }))) as TelegramResponse;
      const wait = result.parameters?.retry_after;
      if (response.status === 429 && retry && wait) {
        await sleep(wait * 1000);
        return this.sendMessage(token, chatId, text, false);
      }
      // 403: the user blocked the bot or never started it.
      if (response.status !== 403) this.logger.warn(`Telegram sendMessage failed (${response.status}): ${result.description ?? ''}`);
      return false;
    } catch (error) {
      // Never log the request URL: it contains the bot token.
      this.logger.warn(`Telegram sendMessage failed: ${(error as Error).name}`);
      return false;
    }
  }
}
