import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class AiStatsQueryDto {
  @ApiPropertyOptional({ type: Number, example: 30, default: 30, description: 'Window in days (1..365)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  @ApiPropertyOptional({ type: Number, example: 10, default: 10, description: 'Top users to list (1..100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  top?: number;
}

export class AiStatsTotalsDto {
  @ApiProperty({ type: Number })
  requests: number;

  @ApiProperty({ type: Number, description: 'Calls that ended with an error' })
  errors: number;

  @ApiProperty({ type: Number })
  promptTokens: number;

  @ApiProperty({ type: Number })
  completionTokens: number;

  @ApiProperty({ type: Number, description: 'USD (provider-reported or estimated)' })
  costUsd: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  avgLatencyMs: number | null;

  @ApiProperty({ type: Number, description: 'Calls with a provider prompt-cache hit' })
  cacheHits: number;
}

export class AiStatsDayDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-01-31' })
  day: string;

  @ApiProperty({ type: Number })
  requests: number;

  @ApiProperty({ type: Number })
  errors: number;

  @ApiProperty({ type: Number })
  tokens: number;

  @ApiProperty({ type: Number })
  costUsd: number;
}

export class AiStatsModelDto {
  @ApiProperty({ type: String, example: 'openrouter' })
  provider: string;

  @ApiProperty({ type: String, example: 'google/gemini-2.5-flash-lite' })
  model: string;

  @ApiProperty({ type: Number })
  requests: number;

  @ApiProperty({ type: Number })
  tokens: number;

  @ApiProperty({ type: Number })
  costUsd: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  avgLatencyMs: number | null;
}

export class AiStatsUserDto {
  @ApiProperty({ type: String })
  userId: string;

  @ApiProperty({ type: Number })
  requests: number;

  @ApiProperty({ type: Number })
  tokens: number;

  @ApiProperty({ type: Number })
  costUsd: number;
}

export class AiStatsDto {
  @ApiProperty({ type: String, format: 'date-time' })
  since: string;

  @ApiProperty({ type: AiStatsTotalsDto })
  totals: AiStatsTotalsDto;

  @ApiProperty({ type: AiStatsDayDto, isArray: true, description: 'Per UTC day, oldest first' })
  byDay: AiStatsDayDto[];

  @ApiProperty({ type: AiStatsModelDto, isArray: true, description: 'Most expensive first' })
  byModel: AiStatsModelDto[];

  @ApiProperty({ type: AiStatsUserDto, isArray: true, description: 'Users with the highest cost, then tokens' })
  topUsers: AiStatsUserDto[];
}
