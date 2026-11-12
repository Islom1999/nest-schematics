/**
 * Optional usage limits for the AI chat. `npm run g -- ai --quota` provides
 * an implementation (AiQuotaModule, global); without it the chat is unlimited
 * (the global rate limiter still applies).
 */
export interface AiChatQuota {
  /** Before a message: throws 429 when the user is over a limit, otherwise counts the message. */
  reserve(userId: string): Promise<void>;
  /** After the answer: adds the tokens it used. */
  addTokens(userId: string, tokens: number): Promise<void>;
}

export const AI_CHAT_QUOTA = Symbol('AI_CHAT_QUOTA');
