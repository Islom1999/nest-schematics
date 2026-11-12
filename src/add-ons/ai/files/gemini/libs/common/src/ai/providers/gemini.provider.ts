import { HttpStatus, Injectable } from '@nestjs/common';
import { AiError } from '../ai.errors';
import { AiHttpOptions, openWithRetry, requestJson, requestSse } from '../ai-http';
import { AiSettings } from '../ai.settings';
import {
  AiContentPart,
  AiImageRequest,
  AiImageResult,
  AiProvider,
  AiRequest,
  AiResult,
  AiStreamChunk,
  AiUsage,
} from '../ai.types';

type GeminiPart = { text?: string; inlineData?: { mimeType?: string; data?: string }; thought?: boolean };

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
}

/** Max size of an image URL downloaded for a vision call. */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * Google Gemini through its REST API (`models/<model>:generateContent`), with
 * plain fetch. Env: GEMINI_API_KEY (sent in the x-goog-api-key header, never
 * in the URL), GEMINI_MODEL, GEMINI_IMAGE_MODEL, GEMINI_BASE_URL. Gemini does
 * not report prices: the cost comes from ai-pricing.ts.
 */
@Injectable()
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  readonly apiKeyEnv = 'GEMINI_API_KEY';

  constructor(private readonly settings: AiSettings) {}

  isConfigured(): boolean {
    return !!this.settings.get('GEMINI_API_KEY');
  }

  defaultModel(): string {
    return this.settings.get('GEMINI_MODEL') ?? 'gemini-2.5-flash-lite';
  }

  defaultImageModel(): string {
    return this.settings.get('GEMINI_IMAGE_MODEL') ?? 'gemini-2.5-flash-image';
  }

  async complete(request: AiRequest): Promise<AiResult> {
    const body = await requestJson<GeminiResponse>(
      this.url(request.model, 'generateContent'),
      this.init(await this.body(request)),
      this.http(request.signal),
    );
    this.checkBlocked(body);
    const candidate = body.candidates?.[0];
    return {
      text: this.text(candidate?.content?.parts),
      model: body.modelVersion ?? request.model,
      provider: this.name,
      usage: this.usage(body.usageMetadata),
      finishReason: candidate?.finishReason ?? null,
    };
  }

  async *stream(request: AiRequest): AsyncGenerator<AiStreamChunk> {
    let model = request.model;
    let usage = this.usage(undefined);
    let finishReason: string | null = null;
    const url = `${this.url(request.model, 'streamGenerateContent')}?alt=sse`;
    for await (const data of requestSse(url, this.init(await this.body(request)), this.http(request.signal))) {
      let chunk: GeminiResponse;
      try {
        chunk = JSON.parse(data) as GeminiResponse;
      } catch {
        continue;
      }
      this.checkBlocked(chunk);
      if (chunk.modelVersion) model = chunk.modelVersion;
      if (chunk.usageMetadata) usage = this.usage(chunk.usageMetadata);
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      const text = this.text(candidate?.content?.parts);
      if (text) yield { type: 'delta', text };
    }
    yield { type: 'done', model, usage, finishReason };
  }

  async image(request: AiImageRequest): Promise<AiImageResult> {
    const payload = {
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    };
    const body = await requestJson<GeminiResponse>(
      this.url(request.model, 'generateContent'),
      this.init(payload),
      this.http(request.signal),
    );
    this.checkBlocked(body);
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    return {
      images: parts
        .filter((p) => p.inlineData?.data)
        .map((p) => ({ mimeType: p.inlineData?.mimeType ?? 'image/png', base64: p.inlineData?.data ?? '' })),
      text: this.text(parts),
      model: body.modelVersion ?? request.model,
      provider: this.name,
      usage: this.usage(body.usageMetadata),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private url(model: string, method: string): string {
    const base = this.settings.get('GEMINI_BASE_URL') ?? 'https://generativelanguage.googleapis.com/v1beta';
    const id = model.replace(/^models\//, '');
    return `${base.replace(/\/+$/, '')}/models/${encodeURIComponent(id)}:${method}`;
  }

  private init(payload: unknown): RequestInit {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.settings.get('GEMINI_API_KEY') ?? '' },
      body: JSON.stringify(payload),
    };
  }

  private http(signal?: AbortSignal): AiHttpOptions {
    return { provider: this.name, timeoutMs: this.settings.timeoutMs, retries: this.settings.maxRetries, signal };
  }

  private async body(request: AiRequest) {
    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')))
      .join('\n\n');
    const contents: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];
    for (const message of request.messages) {
      if (message.role === 'system') continue;
      const parts = typeof message.content === 'string' ? [{ text: message.content }] : await this.parts(message.content, request.signal);
      contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
    }
    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
    if (request.jsonSchema) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseJsonSchema = request.jsonSchema.schema;
    }
    return {
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    };
  }

  private async parts(content: AiContentPart[], signal?: AbortSignal): Promise<GeminiPart[]> {
    const parts: GeminiPart[] = [];
    for (const part of content) {
      if (part.type === 'text') {
        parts.push({ text: part.text });
        continue;
      }
      const dataUrl = part.url ? /^data:([^;]+);base64,(.*)$/s.exec(part.url) : null;
      if (dataUrl) {
        parts.push({ inlineData: { mimeType: dataUrl[1], data: dataUrl[2] } });
      } else if (part.url) {
        parts.push({ inlineData: await this.download(part.url, signal) });
      } else {
        parts.push({ inlineData: { mimeType: part.mimeType ?? 'image/jpeg', data: part.base64 ?? '' } });
      }
    }
    return parts;
  }

  /** Gemini takes images inline: http(s) URLs are downloaded here (size-limited). */
  private async download(url: string, signal?: AbortSignal): Promise<{ mimeType: string; data: string }> {
    if (!/^https?:\/\//i.test(url)) {
      throw new AiError('AI_BAD_REQUEST', 'Image URL must be http(s) or a data: URL.', HttpStatus.BAD_REQUEST);
    }
    const handle = await openWithRetry(url, { method: 'GET' }, { ...this.http(signal), provider: `${this.name} (image download)` });
    try {
      const declared = Number(handle.response.headers.get('content-length') ?? 0);
      if (declared > MAX_IMAGE_BYTES) throw new AiError('AI_BAD_REQUEST', 'Image is too large.', HttpStatus.BAD_REQUEST);
      const buffer = Buffer.from(await handle.response.arrayBuffer());
      if (buffer.length > MAX_IMAGE_BYTES) throw new AiError('AI_BAD_REQUEST', 'Image is too large.', HttpStatus.BAD_REQUEST);
      const mimeType = (handle.response.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
      if (!mimeType.startsWith('image/')) {
        throw new AiError('AI_BAD_REQUEST', `URL is not an image (${mimeType}).`, HttpStatus.BAD_REQUEST);
      }
      return { mimeType, data: buffer.toString('base64') };
    } finally {
      handle.release();
    }
  }

  private text(parts: GeminiPart[] | undefined): string {
    return (parts ?? [])
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('');
  }

  private usage(meta: GeminiResponse['usageMetadata']): AiUsage {
    return {
      promptTokens: meta?.promptTokenCount ?? 0,
      // Thinking tokens are billed as output.
      completionTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
      costUsd: null,
      cacheHit: (meta?.cachedContentTokenCount ?? 0) > 0,
    };
  }

  private checkBlocked(body: GeminiResponse): void {
    const reason = body.promptFeedback?.blockReason;
    if (reason) {
      throw new AiError('AI_BAD_REQUEST', `Gemini blocked the prompt (${reason}).`, HttpStatus.UNPROCESSABLE_ENTITY, {
        provider: this.name,
      });
    }
  }
}
