import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { DAY_RE } from '../ai-days';

/** The user's AI chat usage and limits (0 = no limit). */
export class AiUsageDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-01-31', description: 'UTC day' })
  day: string;

  @ApiProperty({ type: Number })
  dailyMessages: number;

  @ApiProperty({ type: Number, description: 'AI_DAILY_MESSAGES (0 = no limit)' })
  dailyMessageLimit: number;

  @ApiProperty({ type: String, format: 'date-time' })
  dailyResetAt: string;

  @ApiProperty({ type: String, example: '2026-01', description: 'UTC month' })
  month: string;

  @ApiProperty({ type: Number })
  monthlyTokens: number;

  @ApiProperty({ type: Number, description: 'AI_MONTHLY_TOKENS (0 = no limit)' })
  monthlyTokenLimit: number;

  @ApiProperty({ type: String, format: 'date-time' })
  monthlyResetAt: string;
}

/** `GET admin/ai/usage` query. */
export class AiUsageAdminQueryDto {
  @ApiPropertyOptional({ type: String, description: 'Only this user (the id the chat stores: the user uuid)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @ApiPropertyOptional({ type: String, format: 'date', example: '2026-01-01', description: 'First UTC day (inclusive), default 30 days before `to`' })
  @IsOptional()
  @Matches(DAY_RE, { message: 'from must be a day as YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ type: String, format: 'date', example: '2026-01-31', description: 'Last UTC day (inclusive), default today; at most 366 days after `from`' })
  @IsOptional()
  @Matches(DAY_RE, { message: 'to must be a day as YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ type: Number, example: 100, default: 100, description: 'Most rows returned in `daily` and in `monthly` (1..1000)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class AiUsageDayRowDto {
  @ApiProperty({ type: String })
  userId: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-01-31', description: 'UTC day' })
  day: string;

  @ApiProperty({ type: Number })
  messages: number;

  @ApiProperty({ type: Number })
  tokens: number;
}

export class AiUsageMonthRowDto {
  @ApiProperty({ type: String })
  userId: string;

  @ApiProperty({ type: String, example: '2026-01', description: 'UTC month' })
  month: string;

  @ApiProperty({ type: Number })
  messages: number;

  @ApiProperty({ type: Number })
  tokens: number;
}

export class AiUsageTotalsDto {
  @ApiProperty({ type: Number, description: 'Messages in the day window (all rows, not only the returned ones)' })
  dailyMessages: number;

  @ApiProperty({ type: Number })
  dailyTokens: number;

  @ApiProperty({ type: Number, description: 'Distinct users in the day window' })
  dailyUsers: number;

  @ApiProperty({ type: Number, description: 'Messages in the months the window touches' })
  monthlyMessages: number;

  @ApiProperty({ type: Number })
  monthlyTokens: number;

  @ApiProperty({ type: Number })
  monthlyUsers: number;
}

export class AiUsageAdminDto {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'The userId filter, null for everyone' })
  userId: string | null;

  @ApiProperty({ type: String, format: 'date' })
  from: string;

  @ApiProperty({ type: String, format: 'date' })
  to: string;

  @ApiProperty({ type: AiUsageDayRowDto, isArray: true, description: 'Newest day first, then most tokens' })
  daily: AiUsageDayRowDto[];

  @ApiProperty({ type: AiUsageMonthRowDto, isArray: true, description: 'Newest month first, then most tokens' })
  monthly: AiUsageMonthRowDto[];

  @ApiProperty({ type: AiUsageTotalsDto })
  totals: AiUsageTotalsDto;

  @ApiPropertyOptional({ type: AiUsageDto, nullable: true, description: 'With userId: that user\'s usage today and this month, with the limits (as `GET client/ai/usage`)' })
  current: AiUsageDto | null;
}
