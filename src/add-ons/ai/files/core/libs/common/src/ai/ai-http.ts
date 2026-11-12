import { HttpStatus } from '@nestjs/common';
import { AiAbortedError, AiError, AiTimeoutError } from './ai.errors';

/**
 * HTTP layer shared by the AI providers (plain `fetch`, no SDKs):
 * - retries 429, 5xx and network errors with exponential backoff + jitter,
 *   honouring `Retry-After` (seconds or HTTP date);
 * - a timeout per attempt through AbortController (for streams: the longest
 *   silence between two chunks);
 * - the caller's AbortSignal cancels the request (client disconnected);
 * - provider failures become AiError (502 / 503 / 504) with a short message.
 * API keys travel in headers only and are never part of an error message.
 */
export interface AiHttpOptions {
  /** Provider name, for error messages. */
  provider: string;
  timeoutMs: number;
  /** Extra attempts after the first one. */
  retries: number;
  /** First backoff step (doubles every attempt). Default 500 ms. */
  baseDelayMs?: number;
  /** Backoff cap. Default 10 s. */
  maxDelayMs?: number;
  /** A Retry-After longer than this is not waited for: the call fails at once. Default 30 s. */
  maxRetryAfterMs?: number;
  signal?: AbortSignal;
  /** Test seams. */
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

const RETRYABLE_NETWORK = /fetch failed|network|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR/i;

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** `Retry-After: 3` or `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT` → ms (null when absent/invalid). */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** Exponential backoff with "equal jitter": between half and all of base * 2^attempt. */
export function backoffDelay(attempt: number, options: AiHttpOptions): number {
  const base = options.baseDelayMs ?? 500;
  const cap = options.maxDelayMs ?? 10_000;
  const step = Math.min(cap, base * 2 ** attempt);
  const random = options.random ?? Math.random;
  return Math.round(step / 2 + random() * (step / 2));
}

/** Pulls `error.message` (OpenRouter, Gemini) or `message` out of an error body. */
export function upstreamMessage(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const message =
      typeof json.error === 'string' ? json.error : (json.error?.message ?? (typeof json.message === 'string' ? json.message : ''));
    if (typeof message === 'string' && message) return message.replace(/\s+/g, ' ').slice(0, 300);
  } catch {
    // not JSON
  }
  return body.replace(/\s+/g, ' ').slice(0, 200);
}

/** Maps a failed provider response to an AiError. */
export function upstreamError(provider: string, status: number, body: string, retryAfterMs: number | null): AiError {
  const detail = upstreamMessage(body);
  const details = { provider, upstreamStatus: status };
  if (status === 429) {
    return new AiError(
      'AI_RATE_LIMITED',
      `AI provider "${provider}" is rate limiting requests; try again later.${detail ? ` (${detail})` : ''}`,
      HttpStatus.SERVICE_UNAVAILABLE,
      retryAfterMs !== null ? { ...details, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) } : details,
    );
  }
  if (status === 401 || status === 403) {
    return new AiError(
      'AI_AUTH_FAILED',
      `AI provider "${provider}" rejected the API key (check its *_API_KEY in .env).`,
      HttpStatus.SERVICE_UNAVAILABLE,
      details,
    );
  }
  if (status === 402) {
    return new AiError(
      'AI_PROVIDER_ERROR',
      `AI provider "${provider}" refused the request: out of credits or over the spending limit.`,
      HttpStatus.SERVICE_UNAVAILABLE,
      details,
    );
  }
  if (status >= 400 && status < 500) {
    return new AiError('AI_BAD_REQUEST', `AI provider "${provider}" rejected the request: ${detail}`, HttpStatus.BAD_GATEWAY, details);
  }
  return new AiError('AI_PROVIDER_ERROR', `AI provider "${provider}" failed (${status}): ${detail}`, HttpStatus.BAD_GATEWAY, details);
}

/** An open response plus the controls of its attempt. */
export interface AiHttpHandle {
  response: Response;
  /** Restarts the timeout (call it on every stream chunk). */
  touch(): void;
  /** Stops the timer and detaches from the caller's signal. */
  release(): void;
  /** Cancels the underlying request. */
  abort(): void;
  timedOut(): boolean;
}

/**
 * Sends the request, retrying as described above, and resolves with the first
 * 2xx response. The timeout keeps running until `release()`, so reading the
 * body is covered too.
 */
export async function openWithRetry(url: string, init: RequestInit, options: AiHttpOptions): Promise<AiHttpHandle> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw new AiAbortedError(options.provider);
    const controller = new AbortController();
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs);
    };
    const onAbort = () => controller.abort();
    const release = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    arm();

    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      release();
      if (options.signal?.aborted) throw new AiAbortedError(options.provider);
      if (timedOut) throw new AiTimeoutError(options.provider, options.timeoutMs);
      const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
      const causeText = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
      const message = error instanceof Error ? `${error.message} ${causeText}` : '';
      if (attempt < options.retries && RETRYABLE_NETWORK.test(message)) {
        await waitOrAbort(sleep, backoffDelay(attempt, options), options);
        continue;
      }
      throw new AiError(
        'AI_PROVIDER_ERROR',
        `AI provider "${options.provider}" is unreachable: ${message.trim().slice(0, 200) || 'network error'}`,
        HttpStatus.BAD_GATEWAY,
        { provider: options.provider },
      );
    }

    if (response.ok) {
      return { response, touch: arm, release, abort: () => controller.abort(), timedOut: () => timedOut };
    }

    const body = await response.text().catch(() => '');
    release();
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < options.retries) {
      const tooLong = retryAfter !== null && retryAfter > (options.maxRetryAfterMs ?? 30_000);
      if (!tooLong) {
        await waitOrAbort(sleep, retryAfter ?? backoffDelay(attempt, options), options);
        continue;
      }
    }
    throw upstreamError(options.provider, response.status, body, retryAfter);
  }
}

async function waitOrAbort(
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
  ms: number,
  options: AiHttpOptions,
): Promise<void> {
  try {
    await sleep(ms, options.signal);
  } catch {
    throw new AiAbortedError(options.provider);
  }
}

/** Turns an exception thrown while reading a body into an AiError. */
function readError(error: unknown, handle: AiHttpHandle, options: AiHttpOptions): AiError {
  if (error instanceof AiError) return error;
  if (handle.timedOut()) return new AiTimeoutError(options.provider, options.timeoutMs);
  if (options.signal?.aborted) return new AiAbortedError(options.provider);
  const message = error instanceof Error ? error.message : 'stream interrupted';
  return new AiError('AI_PROVIDER_ERROR', `AI provider "${options.provider}" response failed: ${message}`, HttpStatus.BAD_GATEWAY, {
    provider: options.provider,
  });
}

/** POST JSON, read a JSON answer (with retries and timeout). */
export async function requestJson<T>(url: string, init: RequestInit, options: AiHttpOptions): Promise<T> {
  const handle = await openWithRetry(url, init, options);
  try {
    const text = await handle.response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AiError('AI_PROVIDER_ERROR', `AI provider "${options.provider}" sent a non-JSON answer.`, HttpStatus.BAD_GATEWAY, {
        provider: options.provider,
      });
    }
  } catch (error) {
    throw readError(error, handle, options);
  } finally {
    handle.release();
  }
}

/**
 * Splits a Server-Sent Events body into the `data:` payload of each event.
 * Handles events split across chunks, CRLF line endings and `:` comments.
 */
export async function* readSseData(body: ReadableStream<Uint8Array>, onChunk: () => void = () => undefined): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const separator = /\r?\n\r?\n/;
  const dataOf = (event: string) =>
    event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk();
      buffer += decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = separator.exec(buffer))) {
        const data = dataOf(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (data) yield data;
      }
    }
    buffer += decoder.decode();
    const rest = dataOf(buffer);
    if (rest) yield rest;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** POST, then yield every SSE `data:` payload. Retries only before the first byte. */
export async function* requestSse(url: string, init: RequestInit, options: AiHttpOptions): AsyncGenerator<string> {
  const handle = await openWithRetry(url, init, options);
  let finished = false;
  try {
    const body = handle.response.body;
    if (!body) throw new AiError('AI_PROVIDER_ERROR', `AI provider "${options.provider}" sent an empty stream.`, HttpStatus.BAD_GATEWAY);
    try {
      for await (const data of readSseData(body, () => handle.touch())) yield data;
    } catch (error) {
      throw readError(error, handle, options);
    }
    finished = true;
  } finally {
    handle.release();
    // The consumer stopped early (break / client gone): close the upstream connection.
    if (!finished) handle.abort();
  }
}
