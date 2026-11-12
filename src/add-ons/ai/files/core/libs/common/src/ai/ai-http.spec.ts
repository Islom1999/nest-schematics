import { AiError } from './ai.errors';
import { AiHttpOptions, backoffDelay, parseRetryAfter, readSseData, requestJson, requestSse } from './ai-http';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function options(extra: Partial<AiHttpOptions> = {}): AiHttpOptions & { delays: number[] } {
  const delays: number[] = [];
  return {
    provider: 'test',
    timeoutMs: 1000,
    retries: 2,
    random: () => 1,
    sleep: (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    },
    delays,
    ...extra,
  };
}

async function caught(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (error) {
    return error as AiError;
  }
  throw new Error('expected a rejection');
}

describe('ai-http', () => {
  it('retries a 429 and returns the next success', async () => {
    const fetch = jest.fn().mockResolvedValueOnce(json(429, { error: { message: 'slow down' } })).mockResolvedValueOnce(json(200, { ok: true }));
    const opts = options({ fetch });
    await expect(requestJson('https://ai.test/x', { method: 'POST' }, opts)).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(opts.delays).toEqual([500]);
  });

  it('waits for Retry-After (seconds) before retrying', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(json(429, {}, { 'retry-after': '3' }))
      .mockResolvedValueOnce(json(503, {}, { 'retry-after': '1' }))
      .mockResolvedValueOnce(json(200, { ok: 1 }));
    const opts = options({ fetch });
    await expect(requestJson('https://ai.test/x', {}, opts)).resolves.toEqual({ ok: 1 });
    expect(opts.delays).toEqual([3000, 1000]);
  });

  it('gives up at once when Retry-After is too long, with a 503', async () => {
    const fetch = jest.fn().mockResolvedValue(json(429, { error: { message: 'quota' } }, { 'retry-after': '600' }));
    const opts = options({ fetch });
    const error = await caught(requestJson('https://ai.test/x', {}, opts));
    expect(error).toBeInstanceOf(AiError);
    expect(error.getStatus()).toBe(503);
    expect(error.code).toBe('AI_RATE_LIMITED');
    expect(error.details.retryAfterSeconds).toBe(600);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially on 5xx and stops after the retries', async () => {
    const fetch = jest.fn().mockImplementation(() => Promise.resolve(json(502, { error: { message: 'upstream' } })));
    const opts = options({ fetch, baseDelayMs: 100 });
    const error = await caught(requestJson('https://ai.test/x', {}, opts));
    expect(error.getStatus()).toBe(502);
    expect(error.message).toContain('upstream');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(opts.delays).toEqual([100, 200]);
  });

  it('does not retry a 400 and never puts the key in the message', async () => {
    const fetch = jest.fn().mockResolvedValue(json(400, { error: { message: 'bad model' } }));
    const error = await caught(
      requestJson('https://ai.test/x', { headers: { authorization: 'Bearer sk-secret' } }, options({ fetch })),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('AI_BAD_REQUEST');
    expect(JSON.stringify(error.getResponse())).not.toContain('sk-secret');
  });

  it('times out through AbortController (504) without retrying', async () => {
    const fetch = jest.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const error = await caught(requestJson('https://ai.test/x', {}, options({ fetch, timeoutMs: 20 })));
    expect(error.code).toBe('AI_TIMEOUT');
    expect(error.getStatus()).toBe(504);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cancels when the caller aborts', async () => {
    const controller = new AbortController();
    const fetch = jest.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = requestJson('https://ai.test/x', {}, options({ fetch, signal: controller.signal }));
    controller.abort();
    expect((await caught(pending)).code).toBe('AI_ABORTED');
  });

  it('parses Retry-After dates and computes jittered backoff', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(backoffDelay(3, { provider: 't', timeoutMs: 1, retries: 0, baseDelayMs: 100, random: () => 0 })).toBe(400);
    expect(backoffDelay(10, { provider: 't', timeoutMs: 1, retries: 0, maxDelayMs: 1000, random: () => 1 })).toBe(1000);
  });

  it('splits SSE events across chunks, CRLF and comments', async () => {
    const body = sseBody([': keep-alive\n\ndata: {"a"', ':1}\n\ndata: x\r\n\r\nda', 'ta: [DONE]\n\n']);
    const out: string[] = [];
    for await (const data of readSseData(body)) out.push(data);
    expect(out).toEqual(['{"a":1}', 'x', '[DONE]']);
  });

  it('streams data payloads from a retried request', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(json(500, {}))
      .mockResolvedValueOnce(new Response(sseBody(['data: one\n\n', 'data: two\n\n']), { status: 200 }));
    const out: string[] = [];
    for await (const data of requestSse('https://ai.test/s', {}, options({ fetch }))) out.push(data);
    expect(out).toEqual(['one', 'two']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
