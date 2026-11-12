import { ApiProperty } from '@nestjs/swagger';

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
