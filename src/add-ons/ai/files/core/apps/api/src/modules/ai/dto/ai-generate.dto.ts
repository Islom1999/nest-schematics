import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** Body of `POST admin/ai/generate` (try a prompt from the admin panel). */
export class AiGenerateDto {
  @ApiProperty({ example: 'Write a one-line product description for green tea.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  prompt: string;

  @ApiPropertyOptional({ example: 'You are a copywriter.' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  system?: string;

  @ApiPropertyOptional({ example: 'openrouter', description: 'Default AI_PROVIDER' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  provider?: string;

  @ApiPropertyOptional({ example: 'google/gemini-2.5-flash-lite', description: "Default: the provider's *_MODEL" })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  model?: string;

  @ApiPropertyOptional({ type: Number, example: 256 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32000)
  maxTokens?: number;
}

export class AiUsageResultDto {
  @ApiProperty({ type: Number })
  promptTokens: number;

  @ApiProperty({ type: Number })
  completionTokens: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  costUsd: number | null;

  @ApiProperty({ type: Boolean })
  cacheHit: boolean;
}

export class AiGenerateResultDto {
  @ApiProperty()
  text: string;

  @ApiProperty()
  model: string;

  @ApiProperty()
  provider: string;

  @ApiProperty({ type: AiUsageResultDto })
  usage: AiUsageResultDto;

  @ApiPropertyOptional({ type: String, nullable: true })
  finishReason: string | null;
}

export class AiProviderStatusDto {
  @ApiProperty({ example: 'openrouter' })
  name: string;

  @ApiProperty({ type: Boolean, description: 'API key is set' })
  configured: boolean;

  @ApiProperty({ example: 'google/gemini-2.5-flash-lite' })
  defaultModel: string;
}

export class AiStatusDto {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Provider used when a call names none' })
  defaultProvider: string | null;

  @ApiProperty({ type: AiProviderStatusDto, isArray: true })
  providers: AiProviderStatusDto[];
}
