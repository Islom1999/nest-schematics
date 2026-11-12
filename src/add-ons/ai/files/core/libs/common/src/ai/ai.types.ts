import type { JsonSchema } from './json-schema';

export type AiRole = 'system' | 'user' | 'assistant';

/** An image for vision calls: a public http(s) URL, a data URL or raw base64. */
export interface AiImagePart {
  type: 'image';
  /** http(s) URL or `data:image/png;base64,...`. */
  url?: string;
  /** Raw base64 (no data: prefix); give `mimeType` too. */
  base64?: string;
  mimeType?: string;
}

export interface AiTextPart {
  type: 'text';
  text: string;
}

export type AiContentPart = AiTextPart | AiImagePart;

export interface AiMessage {
  role: AiRole;
  content: string | AiContentPart[];
}

/** One provider call, already normalised by AiService. */
export interface AiRequest {
  messages: AiMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** JSON mode: the provider is asked for JSON matching this schema. */
  jsonSchema?: { name: string; schema: JsonSchema };
  signal?: AbortSignal;
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  /** Provider-reported cost (OpenRouter); otherwise estimated from ai-pricing.ts, or null. */
  costUsd: number | null;
  /** Part of the prompt was served from the provider's prompt cache. */
  cacheHit: boolean;
}

export interface AiResult {
  text: string;
  model: string;
  provider: string;
  usage: AiUsage;
  finishReason: string | null;
}

/** What a provider stream yields: text deltas, then one `done`. */
export type AiStreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; model: string; usage: AiUsage; finishReason: string | null };

export interface AiImageRequest {
  prompt: string;
  model: string;
  signal?: AbortSignal;
}

export interface AiGeneratedImage {
  mimeType: string;
  base64: string;
}

export interface AiImageResult {
  images: AiGeneratedImage[];
  text: string;
  model: string;
  provider: string;
  usage: AiUsage;
}

/**
 * One AI backend (OpenRouter, Gemini). Implementations live in `providers/`
 * and are listed in `providers/index.ts`; AiService picks one per call.
 */
export interface AiProvider {
  /** `openrouter`, `gemini`, ... (AI_PROVIDER / `options.provider`). */
  readonly name: string;
  /** False until its API key is set; calls then fail with 503. */
  isConfigured(): boolean;
  /** Env key to set, for the "not configured" message. */
  readonly apiKeyEnv: string;
  defaultModel(): string;
  complete(request: AiRequest): Promise<AiResult>;
  stream(request: AiRequest): AsyncGenerator<AiStreamChunk>;
  /** Image generation, when the provider supports it. */
  image?(request: AiImageRequest): Promise<AiImageResult>;
  defaultImageModel?(): string;
}

/** Options of every AiService call. */
export interface AiCallOptions {
  /** Provider name; default AI_PROVIDER, else the first installed one. */
  provider?: string;
  /** Model id; default the provider's *_MODEL env key. */
  model?: string;
  /** System prompt, prepended to the messages. */
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Stored in ai_logs: who asked ... */
  userId?: string | null;
  /** ... and which feature asked (e.g. `chat`, `product-description`). */
  module?: string;
  /** Cancels the call (e.g. when the HTTP client disconnects). */
  signal?: AbortSignal;
}

/** A prompt string (one user message) or a full conversation. */
export type AiInput = string | AiMessage[];

export const EMPTY_USAGE: AiUsage = { promptTokens: 0, completionTokens: 0, costUsd: null, cacheHit: false };
