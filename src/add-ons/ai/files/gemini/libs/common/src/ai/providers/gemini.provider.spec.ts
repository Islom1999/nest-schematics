import { ConfigService } from '@nestjs/config';
import { AiSettings } from '../ai.settings';
import { AiStreamChunk } from '../ai.types';
import { GeminiProvider } from './gemini.provider';

function provider(env: Record<string, string> = { GEMINI_API_KEY: 'g-test-key', AI_MAX_RETRIES: '1' }) {
  return new GeminiProvider(new AiSettings(new ConfigService(env)));
}

describe('GeminiProvider', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('is not configured without GEMINI_API_KEY', () => {
    expect(provider({}).isConfigured()).toBe(false);
    expect(provider({}).defaultModel()).toBe('gemini-2.5-flash-lite');
  });

  it('calls generateContent with the key in a header and maps roles, system and usage', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: '{"ok":true}' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 6, cachedContentTokenCount: 2 },
        modelVersion: 'gemini-2.5-flash-lite',
      }),
    );
    const result = await provider().complete({
      model: 'gemini-2.5-flash-lite',
      messages: [
        { role: 'system', content: 'Be brief' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: [{ type: 'text', text: 'And this?' }, { type: 'image', url: 'data:image/png;base64,AAAA' }] },
      ],
      jsonSchema: { name: 'r', schema: { type: 'object' } },
    });
    expect(result).toMatchObject({
      text: '{"ok":true}',
      usage: { promptTokens: 10, completionTokens: 10, costUsd: null, cacheHit: true },
      finishReason: 'STOP',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent');
    expect(url).not.toContain('g-test-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-test-key');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Be brief' }] });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Hi' }] },
      { role: 'model', parts: [{ text: 'Hello' }] },
      { role: 'user', parts: [{ text: 'And this?' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] },
    ]);
    expect(body.generationConfig).toEqual({ responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } });
  });

  it('retries a 503 and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":{"message":"overloaded"}}', { status: 503, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    await expect(provider().complete({ model: 'm', messages: [{ role: 'user', content: 'x' }] })).resolves.toMatchObject({ text: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('streams with alt=sse', async () => {
    const events = [
      { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'lo' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } },
    ];
    fetchMock.mockResolvedValueOnce(new Response(events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''), { status: 200 }));
    const chunks: AiStreamChunk[] = [];
    for await (const chunk of provider().stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] })) chunks.push(chunk);
    expect(chunks.map((c) => (c.type === 'delta' ? c.text : c.usage.completionTokens))).toEqual(['Hel', 'lo', 2]);
    expect((fetchMock.mock.calls[0] as [string])[0]).toMatch(/:streamGenerateContent\?alt=sse$/);
  });
});
