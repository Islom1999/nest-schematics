import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { apiEnum } from '@app/common';

/** Body of `POST client/ai/chat/stream`. */
export class AiChatStreamDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Continue this session; omit to start a new one' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiProperty({ example: 'What can I cook with rice and eggs?', maxLength: 8000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  message: string;

  @ApiPropertyOptional({ example: 'default', description: 'System prompt (prompts/<name>.md) of a new session' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,63}$/)
  prompt?: string;
}

export class AiChatPageQueryDto {
  @ApiPropertyOptional({ type: Number, example: 0, description: 'Offset' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  first?: number;

  @ApiPropertyOptional({ type: Number, example: 20, description: 'Page size (1..100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  rows?: number;
}

export enum AiChatEventType {
  META = 'meta',
  DELTA = 'delta',
  DONE = 'done',
  ERROR = 'error',
}

export class AiChatEventUsageDto {
  @ApiProperty({ type: Number })
  promptTokens: number;

  @ApiProperty({ type: Number })
  completionTokens: number;
}

/**
 * One Server-Sent Event of `POST client/ai/chat/stream`: the SSE `event:`
 * line is `type`, the `data:` line is this object as JSON. Order:
 * `meta` → `delta`* → `done` | `error`.
 */
export class AiChatStreamEventDto {
  @ApiProperty({ ...apiEnum(AiChatEventType, 'AiChatEventType') })
  type: AiChatEventType;

  @ApiPropertyOptional({ format: 'uuid', description: 'meta, done, error' })
  sessionId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'meta, done, error: the assistant message' })
  messageId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'meta: the stored user message' })
  userMessageId?: string;

  @ApiPropertyOptional({ description: 'meta, done' })
  model?: string;

  @ApiPropertyOptional({ description: 'delta: the next piece of the answer' })
  text?: string;

  @ApiPropertyOptional({ type: AiChatEventUsageDto, description: 'done' })
  usage?: AiChatEventUsageDto;

  @ApiPropertyOptional({ description: 'error: what went wrong (the partial answer is saved)' })
  error?: string;

  @ApiPropertyOptional({ example: 'AI_TIMEOUT', description: 'error: machine-readable code' })
  code?: string;
}
