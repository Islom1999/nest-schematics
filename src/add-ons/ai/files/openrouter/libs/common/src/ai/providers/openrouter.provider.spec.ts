import { ConfigService } from '@nestjs/config';
import { AiSettings } from '../ai.settings';
import { AiStreamChunk } from '../ai.types';
import { OpenRouterProvider } from './openrouter.provider';

const ENV = {
  OPENROUTER_API_KEY: 'sk-or-test',
  OPENROUTER_MODEL: 'openai/gpt-4o-mini',
  APP_URL: 'https://shop.example',
  APP_NAME: 'Shop',
  AI_MAX_RETRIES: '1',
};

function provider(env: Record<string, string> = ENV) {
  return new OpenRouterProvider(new AiSettings(new ConfigService(env)));
}

function sse(events: unknown[]): Response {
  const text = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('OpenRouterProvider', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('is not configured without OPENROUTER_API_KEY', () => {
    expect(provider({}).isConfigured()).toBe(false);
    expect(provider({}).defaultModel()).toBe('google/gemini-2.5-flash-lite');
  });

  it('calls chat/completions with attribution headers and reads usage and cost', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        model: 'openai/gpt-4o-mini',
        choices: [{ message: { content: 'Hi!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.00042, prompt_tokens_details: { cached_tokens: 8 } },
      }),
    );
    const result = await provider().complete({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'What is it?' }, { type: 'image', base64: 'AAAA', mimeType: 'image/png' }] }],
      maxTokens: 50,
    });
    expect(result).toEqual({
      text: 'Hi!',
      model: 'openai/gpt-4o-mini',
      provider: 'openrouter',
      usage: { promptTokens: 12, completionTokens: 3, costUsd: 0.00042, cacheHit: true },
      finishReason: 'stop',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(url).not.toContain('sk-or-test');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-or-test');
    expect(headers['HTTP-Referer']).toBe('https://shop.example');
    expect(headers['X-Title']).toBe('Shop');
    const body = JSON.parse(init.body as string) as { max_tokens: number; messages: { content: unknown[] }[] };
    expect(body.max_tokens).toBe(50);
    expect(body.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
  });

  it('retries a 429 (Retry-After) and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":{"message":"rate"}}', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'ok' } }] }));
    await expect(provider().complete({ model: 'm', messages: [{ role: 'user', content: 'x' }] })).resolves.toMatchObject({ text: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('streams deltas and the final usage', async () => {
    fetchMock.mockResolvedValueOnce(
      sse([
        { model: 'm1', choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, cost: 0.001 } },
        '[DONE]',
      ]),
    );
    const chunks: AiStreamChunk[] = [];
    for await (const chunk of provider().stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] })) chunks.push(chunk);
    expect(chunks).toEqual([
      { type: 'delta', text: 'Hel' },
      { type: 'delta', text: 'lo' },
      { type: 'done', model: 'm1', usage: { promptTokens: 5, completionTokens: 2, costUsd: 0.001, cacheHit: false }, finishReason: 'stop' },
    ]);
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toMatchObject({ stream: true });
  });

  it('turns an error chunk in the stream into an AiError', async () => {
    fetchMock.mockResolvedValueOnce(sse([{ choices: [{ delta: { content: 'a' } }] }, { error: { code: 502, message: 'provider down' } }]));
    const read = async () => {
      for await (const chunk of provider().stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] })) void chunk;
    };
    await expect(read()).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR', status: 502 });
  });
});
