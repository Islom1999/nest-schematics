import { ConfigService } from '@nestjs/config';
import { AiError } from './ai.errors';
import { AiLogEntry, AiLogService } from './ai-log.service';
import { AiService } from './ai.service';
import { AiSettings } from './ai.settings';
import { AiProvider, AiRequest, AiResult, AiStreamChunk, EMPTY_USAGE } from './ai.types';

class FakeProvider implements AiProvider {
  readonly name = 'fake';
  readonly apiKeyEnv = 'FAKE_API_KEY';
  answers: string[] = [];
  requests: AiRequest[] = [];

  constructor(private readonly configured = true) {}

  isConfigured() {
    return this.configured;
  }

  defaultModel() {
    return 'gemini-2.5-flash-lite';
  }

  async complete(request: AiRequest): Promise<AiResult> {
    this.requests.push(request);
    return {
      text: this.answers.shift() ?? '',
      model: request.model,
      provider: this.name,
      usage: { ...EMPTY_USAGE, promptTokens: 1000, completionTokens: 500 },
      finishReason: 'stop',
    };
  }

  async *stream(request: AiRequest): AsyncGenerator<AiStreamChunk> {
    this.requests.push(request);
    yield { type: 'delta', text: 'Hel' };
    yield { type: 'delta', text: 'lo' };
    yield { type: 'done', model: request.model, usage: { ...EMPTY_USAGE, promptTokens: 3, completionTokens: 2 }, finishReason: 'stop' };
  }
}

function setup(provider: AiProvider, env: Record<string, string> = {}) {
  const entries: AiLogEntry[] = [];
  const logs = {
    record: (entry: AiLogEntry) => {
      entries.push(entry);
      return Promise.resolve();
    },
  } as unknown as AiLogService;
  const service = new AiService([provider], new AiSettings(new ConfigService(env)), logs);
  return { service, entries };
}

describe('AiService', () => {
  it('fails with 503 AI_NOT_CONFIGURED when the API key is missing', async () => {
    const { service } = setup(new FakeProvider(false));
    expect(service.isConfigured()).toBe(false);
    await expect(service.generate('hi')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED', status: 503 });
    expect(() => service.stream('hi')).toThrow(AiError);
  });

  it('fails with 503 for a provider that is not installed', async () => {
    const { service } = setup(new FakeProvider(), { AI_PROVIDER: 'other' });
    await expect(service.generate('hi')).rejects.toMatchObject({ code: 'AI_UNKNOWN_PROVIDER', status: 503 });
  });

  it('logs generate calls with the estimated cost', async () => {
    const provider = new FakeProvider();
    provider.answers.push('Hello');
    const { service, entries } = setup(provider);
    const result = await service.generate('hi', { system: 'Be brief', userId: 'u1', module: 'test' });
    expect(result.text).toBe('Hello');
    expect(result.usage.costUsd).toBeCloseTo(0.0003, 6);
    expect(provider.requests[0].messages[0]).toEqual({ role: 'system', content: 'Be brief' });
    expect(entries[0]).toMatchObject({ operation: 'generate', userId: 'u1', module: 'test', promptTokens: 1000 });
    expect(entries[0].error ?? null).toBeNull();
  });

  it('streams deltas and resolves the result', async () => {
    const { service, entries } = setup(new FakeProvider());
    const stream = service.stream('hi');
    const deltas: string[] = [];
    for await (const delta of stream) deltas.push(delta);
    expect(deltas).toEqual(['Hel', 'lo']);
    await expect(stream.result).resolves.toMatchObject({ text: 'Hello', usage: { promptTokens: 3, completionTokens: 2 } });
    expect(entries[0]).toMatchObject({ operation: 'stream', error: null, completionTokens: 2 });
  });

  it('validates json() answers and repairs once', async () => {
    const provider = new FakeProvider();
    provider.answers.push('{"tags": "x"}', '```json\n{"tags": ["a", "b"]}\n```');
    const { service } = setup(provider);
    const schema = { type: 'object' as const, properties: { tags: { type: 'array' as const, items: { type: 'string' as const } } }, required: ['tags'] };
    await expect(service.json<{ tags: string[] }>('tag it', schema)).resolves.toEqual({ tags: ['a', 'b'] });
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].messages.at(-1)?.content).toContain('$.tags: expected array');
  });

  it('throws 502 AI_INVALID_JSON when the repair is still invalid', async () => {
    const provider = new FakeProvider();
    provider.answers.push('nope', '{"other": 1}');
    const { service } = setup(provider);
    await expect(service.json('x', { type: 'object', required: ['tags'] })).rejects.toMatchObject({ code: 'AI_INVALID_JSON', status: 502 });
  });
});
