import { HttpStatus, Injectable } from '@nestjs/common';
import { AiError } from '../ai.errors';
import { AiHttpOptions, requestJson, requestSse } from '../ai-http';
import { AiSettings } from '../ai.settings';
import {
  AiContentPart,
  AiImageRequest,
  AiImageResult,
  AiMessage,
  AiProvider,
  AiRequest,
  AiResult,
  AiStreamChunk,
  AiUsage,
} from '../ai.types';

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface OpenRouterResponse {
  model?: string;
  choices?: {
    message?: { content?: string | null; images?: { image_url?: { url?: string } }[] };
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: OpenRouterUsage;
  error?: { message?: string; code?: number | string };
}

type OpenRouterContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

/**
 * OpenRouter (https://openrouter.ai) through its OpenAI-compatible
 * `chat/completions` API, with plain fetch. Env: OPENROUTER_API_KEY,
 * OPENROUTER_MODEL, OPENROUTER_IMAGE_MODEL, OPENROUTER_BASE_URL; APP_URL /
 * APP_NAME are sent as HTTP-Referer / X-Title (app attribution).
 * OpenRouter reports the real cost of every call (`usage.cost`).
 */
@Injectable()
export class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter';
  readonly apiKeyEnv = 'OPENROUTER_API_KEY';

  constructor(private readonly settings: AiSettings) {}

  isConfigured(): boolean {
    return !!this.settings.get('OPENROUTER_API_KEY');
  }

  defaultModel(): string {
    return this.settings.get('OPENROUTER_MODEL') ?? 'google/gemini-2.5-flash-lite';
  }

  defaultImageModel(): string {
    return this.settings.get('OPENROUTER_IMAGE_MODEL') ?? 'google/gemini-2.5-flash-image';
  }

  async complete(request: AiRequest): Promise<AiResult> {
    const body = await requestJson<OpenRouterResponse>(this.url(), this.init(this.body(request, false)), this.http(request.signal));
    if (body.error) throw this.bodyError(body.error);
    const choice = body.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      model: body.model ?? request.model,
      provider: this.name,
      usage: this.usage(body.usage),
      finishReason: choice?.finish_reason ?? null,
    };
  }

  async *stream(request: AiRequest): AsyncGenerator<AiStreamChunk> {
    let model = request.model;
    let usage: AiUsage = this.usage(undefined);
    let finishReason: string | null = null;
    for await (const data of requestSse(this.url(), this.init(this.body(request, true)), this.http(request.signal))) {
      if (data === '[DONE]') break;
      let chunk: OpenRouterResponse;
      try {
        chunk = JSON.parse(data) as OpenRouterResponse;
      } catch {
        continue;
      }
      if (chunk.error) throw this.bodyError(chunk.error);
      if (chunk.model) model = chunk.model;
      if (chunk.usage) usage = this.usage(chunk.usage);
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const text = choice?.delta?.content;
      if (text) yield { type: 'delta', text };
    }
    yield { type: 'done', model, usage, finishReason };
  }

  async image(request: AiImageRequest): Promise<AiImageResult> {
    const payload = {
      model: request.model,
      messages: [{ role: 'user', content: request.prompt }],
      modalities: ['image', 'text'],
      usage: { include: true },
    };
    const body = await requestJson<OpenRouterResponse>(this.url(), this.init(payload), this.http(request.signal));
    if (body.error) throw this.bodyError(body.error);
    const message = body.choices?.[0]?.message;
    const images = (message?.images ?? [])
      .map((i) => /^data:([^;]+);base64,(.*)$/s.exec(i.image_url?.url ?? ''))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ mimeType: m[1], base64: m[2] }));
    return {
      images,
      text: message?.content ?? '',
      model: body.model ?? request.model,
      provider: this.name,
      usage: this.usage(body.usage),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private url(): string {
    const base = this.settings.get('OPENROUTER_BASE_URL') ?? 'https://openrouter.ai/api/v1';
    return `${base.replace(/\/+$/, '')}/chat/completions`;
  }

  private init(payload: unknown): RequestInit {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.settings.get('OPENROUTER_API_KEY') ?? ''}`,
    };
    const appUrl = this.settings.get('APP_URL');
    const appName = this.settings.get('APP_NAME');
    if (appUrl) headers['HTTP-Referer'] = appUrl;
    if (appName) headers['X-Title'] = appName;
    return { method: 'POST', headers, body: JSON.stringify(payload) };
  }

  private http(signal?: AbortSignal): AiHttpOptions {
    return { provider: this.name, timeoutMs: this.settings.timeoutMs, retries: this.settings.maxRetries, signal };
  }

  private body(request: AiRequest, stream: boolean) {
    return {
      model: request.model,
      messages: request.messages.map((m) => ({ role: m.role, content: this.content(m) })),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      ...(request.jsonSchema
        ? { response_format: { type: 'json_schema', json_schema: { name: request.jsonSchema.name, schema: request.jsonSchema.schema } } }
        : {}),
      ...(stream ? { stream: true } : {}),
      // Cost and cached tokens in `usage` (also in the last stream chunk).
      usage: { include: true },
    };
  }

  private content(message: AiMessage): OpenRouterContent {
    if (typeof message.content === 'string') return message.content;
    return message.content.map((part: AiContentPart) => {
      if (part.type === 'text') return { type: 'text' as const, text: part.text };
      const url = part.url ?? `data:${part.mimeType ?? 'image/jpeg'};base64,${part.base64 ?? ''}`;
      return { type: 'image_url' as const, image_url: { url } };
    });
  }

  private usage(usage: OpenRouterUsage | undefined): AiUsage {
    return {
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      costUsd: typeof usage?.cost === 'number' ? usage.cost : null,
      cacheHit: (usage?.prompt_tokens_details?.cached_tokens ?? 0) > 0,
    };
  }

  private bodyError(error: NonNullable<OpenRouterResponse['error']>): AiError {
    const code = typeof error.code === 'number' ? error.code : 0;
    return new AiError(
      code === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR',
      `AI provider "${this.name}" failed: ${(error.message ?? 'unknown error').slice(0, 300)}`,
      code === 429 ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY,
      { provider: this.name, upstreamStatus: code || undefined },
    );
  }
}
