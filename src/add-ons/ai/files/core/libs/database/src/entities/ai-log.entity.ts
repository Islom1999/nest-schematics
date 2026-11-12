import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, ValueTransformer } from 'typeorm';
import { BaseEntity } from '../base.entity';

/** numeric → number (pg returns numeric columns as strings). */
export const numericToNumber: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null || value === undefined ? null : Number(value)),
};

/**
 * One AI provider call (`npm run g -- ai`), written by AiService for every
 * generate / stream / vision / json / image call, failed ones included.
 * Prompt and answer are stored only with AI_LOG_BODIES=true; API keys never.
 * Schema: migration `*-ai-logs.ts` (keep both in sync).
 */
@Entity({ name: 'ai_logs' })
@Index('IDX_ai_logs_created_at', ['createdAt'])
export class AiLog extends BaseEntity {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'User the call was made for' })
  @Index('IDX_ai_logs_user_id')
  @Column({ type: 'varchar', length: 64, nullable: true })
  userId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'chat', description: 'Feature that made the call' })
  @Column({ type: 'varchar', length: 64, nullable: true })
  module: string | null;

  @ApiProperty({ example: 'generate', description: 'generate, stream, vision, json or image' })
  @Column({ type: 'varchar', length: 16 })
  operation: string;

  @ApiProperty({ example: 'openrouter' })
  @Column({ type: 'varchar', length: 32 })
  provider: string;

  @ApiProperty({ example: 'google/gemini-2.5-flash-lite' })
  @Index('IDX_ai_logs_model')
  @Column({ type: 'varchar', length: 128 })
  model: string;

  @ApiProperty({ type: Number })
  @Column({ type: 'int', default: 0 })
  promptTokens: number;

  @ApiProperty({ type: Number })
  @Column({ type: 'int', default: 0 })
  completionTokens: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Provider-reported or estimated (ai-pricing.ts)' })
  @Column({ type: 'numeric', precision: 12, scale: 6, nullable: true, transformer: numericToNumber })
  costUsd: number | null;

  @ApiProperty({ type: Number })
  @Column({ type: 'int', default: 0 })
  latencyMs: number;

  @ApiProperty({ type: Boolean, description: 'The provider served part of the prompt from its cache' })
  @Column({ type: 'boolean', default: false })
  cacheHit: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: 'Only with AI_LOG_BODIES=true' })
  @Column({ type: 'jsonb', nullable: true })
  requestBody: unknown;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: 'Only with AI_LOG_BODIES=true' })
  @Column({ type: 'jsonb', nullable: true })
  responseBody: unknown;
}
