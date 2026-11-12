import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { DAY_RE } from '../ai-days';

export class AiStatsQueryDto {
  @ApiPropertyOptional({ type: Number, example: 30, default: 30, description: 'Window in days (1..365) ending now, or ending at `to`; ignored when `from` is set' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    example: '2026-01-01',
    description: 'First UTC day of the window (inclusive). Without from/to the window is the last `days` days up to now',
  })
  @IsOptional()
  @Matches(DAY_RE, { message: 'from must be a day as YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ type: String, format: 'date', example: '2026-01-31', description: 'Last UTC day of the window (inclusive), default today. At most 366 days after from' })
  @IsOptional()
  @Matches(DAY_RE, { message: 'to must be a day as YYYY-MM-DD' })
  to?: string;

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

export class AiStatsCostDayDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-01-31' })
  day: string;

  @ApiProperty({ type: Number, description: 'USD that day (0 on days without calls)' })
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
  @ApiProperty({ type: String, format: 'date-time', description: 'Start of the window' })
  since: string;

  @ApiProperty({ type: String, format: 'date', description: 'First UTC day of the window' })
  from: string;

  @ApiProperty({ type: String, format: 'date', description: 'Last UTC day of the window' })
  to: string;

  @ApiProperty({ type: AiStatsTotalsDto })
  totals: AiStatsTotalsDto;

  @ApiProperty({ type: AiStatsDayDto, isArray: true, description: 'Per UTC day, oldest first' })
  byDay: AiStatsDayDto[];

  @ApiProperty({ type: AiStatsCostDayDto, isArray: true, description: 'Cost per UTC day from `from` to `to`, every day present (0 when idle), oldest first' })
  costByDay: AiStatsCostDayDto[];

  @ApiProperty({ type: AiStatsModelDto, isArray: true, description: 'Most expensive first' })
  byModel: AiStatsModelDto[];

  @ApiProperty({ type: AiStatsUserDto, isArray: true, description: 'Users with the highest cost, then tokens' })
  topUsers: AiStatsUserDto[];
}
