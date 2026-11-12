import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AiError, AiNotConfiguredError, errorMessage } from './ai.errors';
import { AiLogService } from './ai-log.service';
import { estimateCostUsd } from './ai-pricing';
import { AiSettings } from './ai.settings';
import { AiStream } from './ai-stream';
import {
  AiCallOptions,
  AiImageResult,
  AiInput,
  AiMessage,
  AiProvider,
  AiRequest,
  AiResult,
  AiUsage,
  EMPTY_USAGE,
} from './ai.types';
import { JsonSchema, parseJsonAnswer, validateJsonSchema } from './json-schema';

/** Injection token: every installed provider (providers/index.ts). */
export const AI_PROVIDERS = Symbol('AI_PROVIDERS');

export interface AiJsonOptions extends AiCallOptions {
  /** Schema name sent to the provider. Default `response`. */
  schemaName?: string;
}

/**
 * The one entry point for AI calls (`npm run g -- ai`). Providers are
 * interchangeable (AI_PROVIDER, or `options.provider` per call); every call
 * is logged to ai_logs with tokens, cost, latency and errors.
 *
 *   const { text } = await ai.generate('Summarise: ...', { module: 'reviews', userId });
 *   for await (const delta of ai.stream(messages)) ...
 *   const tags = await ai.json<{ tags: string[] }>(prompt, { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } }, required: ['tags'] });
 *   const { text } = await ai.vision('https://.../photo.jpg', 'What is in the picture?');
 *
 * Without the provider's API key every call fails with 503 AI_NOT_CONFIGURED.
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(AI_PROVIDERS) private readonly providers: AiProvider[],
    private readonly settings: AiSettings,
    private readonly logs: AiLogService,
  ) {}

  /** Installed providers (`openrouter`, `gemini`). */
  providerNames(): string[] {
    return this.providers.map((p) => p.name);
  }

  /** Installed providers, whether their key is set, and the default one. */
  status(): { defaultProvider: string | null; providers: { name: string; configured: boolean; defaultModel: string }[] } {
    return {
      defaultProvider: this.find()?.name ?? null,
      providers: this.providers.map((p) => ({ name: p.name, configured: p.isConfigured(), defaultModel: p.defaultModel() })),
    };
  }

  isConfigured(provider?: string): boolean {
    const found = this.find(provider);
    return !!found && found.isConfigured();
  }

  /** The provider a call would use; throws 503 when it is missing or has no API key. */
  provider(name?: string): AiProvider {
    const found = this.find(name);
    if (!found) {
      throw new AiError(
        'AI_UNKNOWN_PROVIDER',
        `AI provider "${name ?? this.settings.defaultProvider ?? ''}" is not installed (installed: ${this.providerNames().join(', ') || 'none'}; add one with "npm run g -- ai <provider>").`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!found.isConfigured()) throw new AiNotConfiguredError(found.name, found.apiKeyEnv);
    return found;
  }

  /** Text answer to a prompt or conversation. */
  async generate(input: AiInput, options: AiCallOptions = {}): Promise<AiResult> {
    return this.complete('generate', this.messages(input, options), options);
  }

  /**
   * Streams the answer as text deltas (see AiStream). Fails at once (before
   * any I/O) when the provider is not configured, so an HTTP handler can still
   * answer 503 before it starts an event stream.
   */
  stream(input: AiInput, options: AiCallOptions = {}): AiStream {
    const provider = this.provider(options.provider);
    const request = this.request(provider, this.messages(input, options), options);
    return new AiStream(this.runStream(provider, request, options));
  }

  /**
   * Answer about an image: an http(s) URL, a data URL or raw base64
   * (`mimeType` in options, default image/jpeg). URLs are fetched by the
   * provider or by this server: only pass URLs you trust.
   */
  async vision(image: string, prompt: string, options: AiCallOptions & { mimeType?: string } = {}): Promise<AiResult> {
    const isUrl = /^(https?:|data:)/i.test(image);
    const messages: AiMessage[] = [
      ...(options.system ? [{ role: 'system' as const, content: options.system }] : []),
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          isUrl ? { type: 'image', url: image } : { type: 'image', base64: image, mimeType: options.mimeType ?? 'image/jpeg' },
        ],
      },
    ];
    return this.complete('vision', messages, options);
  }

  /**
   * Structured answer: asks for JSON matching `schema`, parses and validates
   * it, and on failure asks the model once to repair its answer. Throws 502
   * AI_INVALID_JSON when the second answer is still invalid.
   */
  async json<T = unknown>(input: AiInput, schema: JsonSchema, options: AiJsonOptions = {}): Promise<T> {
    const instruction =
      'Reply with JSON only (no prose, no code fences) that matches this JSON Schema:\n' + JSON.stringify(schema);
    const system = options.system ? `${options.system}\n\n${instruction}` : instruction;
    const messages = this.messages(input, { ...options, system });
    const jsonSchema = { name: options.schemaName ?? 'response', schema };

    const first = await this.complete('json', messages, options, jsonSchema);
    const checked = this.checkJson(first.text, schema);
    if (checked.ok) return checked.value as T;

    const repair: AiMessage[] = [
      ...messages,
      { role: 'assistant', content: first.text },
      {
        role: 'user',
        content: `That answer is not valid: ${checked.errors.slice(0, 10).join('; ')}. Reply again with only the corrected JSON.`,
      },
    ];
    const second = await this.complete('json', repair, options, jsonSchema);
    const again = this.checkJson(second.text, schema);
    if (again.ok) return again.value as T;
    throw new AiError(
      'AI_INVALID_JSON',
      `The AI answer did not match the expected JSON shape: ${again.errors.slice(0, 5).join('; ')}`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  /** Generated image(s), when the provider supports it (OPENROUTER_IMAGE_MODEL / GEMINI_IMAGE_MODEL). */
  async image(prompt: string, options: AiCallOptions = {}): Promise<AiImageResult> {
    const provider = this.provider(options.provider);
    if (!provider.image) {
      throw new AiError('AI_UNSUPPORTED', `AI provider "${provider.name}" cannot generate images.`, HttpStatus.NOT_IMPLEMENTED);
    }
    const model = options.model ?? provider.defaultImageModel?.() ?? provider.defaultModel();
    const started = Date.now();
    try {
      const result = await provider.image({ prompt, model, signal: options.signal });
      const usage = this.withCost(result.model, result.usage);
      void this.logs.record({
        operation: 'image',
        provider: provider.name,
        model: result.model,
        userId: options.userId,
        module: options.module,
        ...this.usageColumns(usage),
        latencyMs: Date.now() - started,
        request: { prompt, model },
        response: { text: result.text, images: result.images.map((i) => ({ mimeType: i.mimeType, size: i.base64.length })) },
      });
      return { ...result, usage };
    } catch (error) {
      void this.logs.record({
        operation: 'image',
        provider: provider.name,
        model,
        userId: options.userId,
        module: options.module,
        latencyMs: Date.now() - started,
        error: errorMessage(error),
        request: { prompt, model },
      });
      throw error;
    }
  }

  // ── internals ──────────────────────────────────────────────────────────

  private find(name?: string): AiProvider | undefined {
    const wanted = name ?? this.settings.defaultProvider;
    if (!wanted) return this.providers[0];
    return this.providers.find((p) => p.name === wanted);
  }

  private messages(input: AiInput, options: AiCallOptions): AiMessage[] {
    const list: AiMessage[] = typeof input === 'string' ? [{ role: 'user', content: input }] : [...input];
    return options.system ? [{ role: 'system', content: options.system }, ...list] : list;
  }

  private request(provider: AiProvider, messages: AiMessage[], options: AiCallOptions): AiRequest {
    return {
      messages,
      model: options.model ?? provider.defaultModel(),
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      signal: options.signal,
    };
  }

  private withCost(model: string, usage: AiUsage): AiUsage {
    if (usage.costUsd !== null) return usage;
    return { ...usage, costUsd: estimateCostUsd(model, usage.promptTokens, usage.completionTokens) };
  }

  private usageColumns(usage: AiUsage) {
    return {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: usage.costUsd,
      cacheHit: usage.cacheHit,
    };
  }

  private async complete(
    operation: string,
    messages: AiMessage[],
    options: AiCallOptions,
    jsonSchema?: AiRequest['jsonSchema'],
  ): Promise<AiResult> {
    const provider = this.provider(options.provider);
    const request = { ...this.request(provider, messages, options), jsonSchema };
    const started = Date.now();
    try {
      const raw = await provider.complete(request);
      const result = { ...raw, usage: this.withCost(raw.model, raw.usage) };
      void this.logs.record({
        operation,
        provider: provider.name,
        model: result.model,
        userId: options.userId,
        module: options.module,
        ...this.usageColumns(result.usage),
        latencyMs: Date.now() - started,
        request: this.loggedRequest(request),
        response: { text: result.text, finishReason: result.finishReason },
      });
      return result;
    } catch (error) {
      void this.logs.record({
        operation,
        provider: provider.name,
        model: request.model,
        userId: options.userId,
        module: options.module,
        latencyMs: Date.now() - started,
        error: errorMessage(error),
        request: this.loggedRequest(request),
      });
      throw error;
    }
  }

  private async *runStream(provider: AiProvider, request: AiRequest, options: AiCallOptions): AsyncGenerator<string, AiResult> {
    const started = Date.now();
    let text = '';
    let done: AiResult | null = null;
    let failure: unknown = null;
    try {
      for await (const chunk of provider.stream(request)) {
        if (chunk.type === 'delta') {
          text += chunk.text;
          yield chunk.text;
        } else {
          done = {
            text,
            model: chunk.model,
            provider: provider.name,
            usage: this.withCost(chunk.model, chunk.usage),
            finishReason: chunk.finishReason,
          };
        }
      }
      done ??= {
        text,
        model: request.model,
        provider: provider.name,
        usage: this.withCost(request.model, EMPTY_USAGE),
        finishReason: null,
      };
      done.text = text;
      return done;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      const usage = done?.usage ?? EMPTY_USAGE;
      void this.logs.record({
        operation: 'stream',
        provider: provider.name,
        model: done?.model ?? request.model,
        userId: options.userId,
        module: options.module,
        ...this.usageColumns(usage),
        latencyMs: Date.now() - started,
        error: done ? null : failure ? errorMessage(failure) : 'cancelled by the caller',
        request: this.loggedRequest(request),
        response: { text, finishReason: done?.finishReason ?? null },
      });
    }
  }

  private loggedRequest(request: AiRequest) {
    return {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      jsonSchema: request.jsonSchema,
    };
  }

  private checkJson(text: string, schema: JsonSchema): { ok: true; value: unknown } | { ok: false; errors: string[] } {
    let value: unknown;
    try {
      value = parseJsonAnswer(text);
    } catch {
      return { ok: false, errors: ['the answer is not valid JSON'] };
    }
    const errors = validateJsonSchema(value, schema);
    return errors.length ? { ok: false, errors } : { ok: true, value };
  }
}
