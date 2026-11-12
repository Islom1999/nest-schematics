import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AiMessage, AiService, AiStream, errorMessage, isAiError, PaginatedResult } from '@app/common';
import { AiChatMessage, AiChatMessageStatus, AiChatRole, AiChatSession } from '@app/database';
import { AI_CHAT_QUOTA, AiChatQuota } from './ai-chat.quota';
import { AiPromptsService } from './ai-prompts.service';
import { AiChatEventType, AiChatPageQueryDto, AiChatStreamDto, AiChatStreamEventDto } from './dto/ai-chat.dto';

/** A chat turn that passed every check and is ready to stream. */
export interface PreparedChat {
  userId: string;
  session: AiChatSession;
  userMessage: AiChatMessage;
  assistant: AiChatMessage;
  model: string;
  stream: AiStream;
  signal: AbortSignal;
}

function intEnv(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * AI chat of client users: sessions, history and streamed answers. Settings:
 * AI_CHAT_PROVIDER / AI_CHAT_MODEL (default: AI_PROVIDER and its model),
 * AI_CHAT_HISTORY (messages sent as context, default 20), AI_CHAT_MAX_TOKENS
 * (answer length, default 1024). System prompts: prompts/*.md.
 */
@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    @InjectRepository(AiChatSession) private readonly sessions: Repository<AiChatSession>,
    @InjectRepository(AiChatMessage) private readonly messages: Repository<AiChatMessage>,
    private readonly ai: AiService,
    private readonly prompts: AiPromptsService,
    private readonly config: ConfigService,
    @Optional() @Inject(AI_CHAT_QUOTA) private readonly quota?: AiChatQuota,
  ) {}

  /**
   * Checks everything that can fail with a plain HTTP error (503 not
   * configured, 404 session, 400 prompt, 429 quota), stores the user message
   * and opens the provider stream. Nothing is sent to the client yet.
   */
  async prepare(userId: string, dto: AiChatStreamDto, signal: AbortSignal): Promise<PreparedChat> {
    const providerName = this.config.get<string>('AI_CHAT_PROVIDER')?.trim() || undefined;
    const provider = this.ai.provider(providerName);
    const model = this.config.get<string>('AI_CHAT_MODEL')?.trim() || provider.defaultModel();

    const session = dto.sessionId
      ? await this.ownSession(userId, dto.sessionId)
      : this.sessions.create({ userId, title: this.title(dto.message), prompt: dto.prompt ?? 'default', messageCount: 0 });
    const system = this.prompts.get(session.prompt);
    if (this.quota) await this.quota.reserve(userId);

    const history = await this.history(session);
    if (!session.id) await this.sessions.save(session);
    const userMessage = await this.messages.save(
      this.messages.create({ sessionId: session.id, role: AiChatRole.USER, content: dto.message, status: AiChatMessageStatus.COMPLETE }),
    );
    const assistant = await this.messages.save(
      this.messages.create({ sessionId: session.id, role: AiChatRole.ASSISTANT, content: '', status: AiChatMessageStatus.STREAMING, model }),
    );

    const stream = this.ai.stream([...history, { role: 'user', content: dto.message }], {
      provider: providerName,
      model,
      system,
      maxTokens: intEnv(this.config.get('AI_CHAT_MAX_TOKENS'), 1024),
      userId,
      module: 'chat',
      signal,
    });
    return { userId, session, userMessage, assistant, model, stream, signal };
  }

  /**
   * Streams the answer through `send` (meta → delta* → done | error) and
   * saves it. Never throws: a failure is saved with the partial answer and
   * reported as an `error` event (not sent when the client is gone).
   */
  async run(chat: PreparedChat, send: (event: AiChatStreamEventDto) => void): Promise<void> {
    const ids = { sessionId: chat.session.id, messageId: chat.assistant.id };
    send({ type: AiChatEventType.META, ...ids, userMessageId: chat.userMessage.id, model: chat.model });
    try {
      for await (const text of chat.stream) send({ type: AiChatEventType.DELTA, text });
      const result = await chat.stream.result;
      const usage = { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens };
      await this.finish(chat, AiChatMessageStatus.COMPLETE, result.text, result.model, usage, null);
      if (this.quota) await this.quota.addTokens(chat.userId, usage.promptTokens + usage.completionTokens);
      send({ type: AiChatEventType.DONE, ...ids, model: result.model, usage });
    } catch (error) {
      const aborted = chat.signal.aborted;
      const message = errorMessage(error);
      const status = aborted ? AiChatMessageStatus.ABORTED : AiChatMessageStatus.ERROR;
      await this.finish(chat, status, chat.stream.text, chat.model, null, aborted ? 'cancelled by the client' : message).catch((e) =>
        this.logger.error(`Saving the partial answer failed: ${errorMessage(e)}`),
      );
      if (!aborted) send({ type: AiChatEventType.ERROR, ...ids, error: message, code: isAiError(error) ? error.code : 'AI_CHAT_FAILED' });
    }
  }

  async listSessions(userId: string, query: AiChatPageQueryDto): Promise<PaginatedResult<AiChatSession>> {
    const [data, count] = await this.sessions.findAndCount({
      where: { userId },
      order: { lastMessageAt: { direction: 'DESC', nulls: 'LAST' }, createdAt: 'DESC' },
      skip: query.first ?? 0,
      take: query.rows ?? 20,
    });
    return { count, data };
  }

  /** Messages of one of the user's sessions, oldest first. */
  async listMessages(userId: string, sessionId: string, query: AiChatPageQueryDto): Promise<PaginatedResult<AiChatMessage>> {
    await this.ownSession(userId, sessionId);
    const [data, count] = await this.messages.findAndCount({
      where: { sessionId },
      order: { createdAt: 'ASC' },
      skip: query.first ?? 0,
      take: query.rows ?? 50,
    });
    return { count, data };
  }

  /** Deletes the session and its messages (hard delete). */
  async deleteSession(userId: string, sessionId: string): Promise<{ deleted: boolean; id: string }> {
    const result = await this.sessions.delete({ id: sessionId, userId });
    if (!result.affected) throw new NotFoundException('Chat session not found');
    return { deleted: true, id: sessionId };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async ownSession(userId: string, id: string): Promise<AiChatSession> {
    const session = await this.sessions.findOne({ where: { id, userId } });
    if (!session) throw new NotFoundException('Chat session not found');
    return session;
  }

  /** The last AI_CHAT_HISTORY messages with content, oldest first. */
  private async history(session: AiChatSession): Promise<AiMessage[]> {
    if (!session.id) return [];
    const rows = await this.messages.find({
      where: {
        sessionId: session.id,
        status: In([AiChatMessageStatus.COMPLETE, AiChatMessageStatus.ERROR, AiChatMessageStatus.ABORTED]),
      },
      order: { createdAt: 'DESC' },
      take: intEnv(this.config.get('AI_CHAT_HISTORY'), 20),
    });
    return rows
      .reverse()
      .filter((m) => m.content.trim())
      .map((m): AiMessage => ({ role: m.role === AiChatRole.ASSISTANT ? 'assistant' : 'user', content: m.content }));
  }

  private async finish(
    chat: PreparedChat,
    status: AiChatMessageStatus,
    content: string,
    model: string,
    usage: { promptTokens: number; completionTokens: number } | null,
    error: string | null,
  ): Promise<void> {
    await this.messages.update(chat.assistant.id, {
      status,
      content,
      model,
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
      error,
    });
    await this.sessions.update(chat.session.id, {
      model,
      lastMessageAt: new Date(),
      messageCount: () => 'message_count + 2',
    });
  }

  private title(message: string): string {
    const text = message.replace(/\s+/g, ' ').trim();
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }
}
