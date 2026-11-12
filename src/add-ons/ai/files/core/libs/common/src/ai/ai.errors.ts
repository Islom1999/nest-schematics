import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export type AiErrorCode =
  | 'AI_NOT_CONFIGURED'
  | 'AI_UNKNOWN_PROVIDER'
  | 'AI_UNSUPPORTED'
  | 'AI_RATE_LIMITED'
  | 'AI_AUTH_FAILED'
  | 'AI_PROVIDER_ERROR'
  | 'AI_BAD_REQUEST'
  | 'AI_TIMEOUT'
  | 'AI_ABORTED'
  | 'AI_INVALID_JSON';

/**
 * Every AI failure is an HttpException with a stable `code`, so a controller
 * that lets it through answers with a sensible status (503 when AI is not
 * configured, 502/504 for provider trouble) and a readable message.
 */
export class AiError extends HttpException {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super({ statusCode: status, error: STATUS_CODES[status] ?? 'Error', code, message, ...details }, status);
  }
}

/** 503: the provider's API key is not set (the app still boots without it). */
export class AiNotConfiguredError extends AiError {
  constructor(provider: string, envKey: string) {
    super(
      'AI_NOT_CONFIGURED',
      `AI is not configured: set ${envKey} in .env to use the "${provider}" provider.`,
      HttpStatus.SERVICE_UNAVAILABLE,
      { provider },
    );
  }
}

/** 504: no answer within AI_TIMEOUT_MS. */
export class AiTimeoutError extends AiError {
  constructor(provider: string, timeoutMs: number) {
    super('AI_TIMEOUT', `AI provider "${provider}" did not answer within ${timeoutMs} ms.`, HttpStatus.GATEWAY_TIMEOUT, {
      provider,
    });
  }
}

/** The caller cancelled (client disconnected). 499 = "client closed request". */
export class AiAbortedError extends AiError {
  constructor(provider: string) {
    super('AI_ABORTED', `AI request to "${provider}" was cancelled.`, 499, { provider });
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}

/** Short, single-line text of any error (for logs and SSE error events). */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
  return text.replace(/\s+/g, ' ').slice(0, 500);
}
