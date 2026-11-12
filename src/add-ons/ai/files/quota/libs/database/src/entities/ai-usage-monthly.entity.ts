import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * AI chat usage of one user in one UTC month (`month` = its first day).
 * Counters are incremented with atomic upserts. Schema: migration `*-ai-quota.ts`.
 */
@Entity({ name: 'ai_usage_monthly' })
@Index('UQ_ai_usage_monthly_user_id_month', ['userId', 'month'], { unique: true })
export class AiUsageMonthly extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'varchar', length: 64 })
  userId: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-01-01' })
  @Column({ type: 'date' })
  month: string;

  @ApiProperty({ type: Number })
  @Column({ type: 'int', default: 0 })
  messages: number;

  @ApiProperty({ type: Number })
  @Column({ type: 'int', default: 0 })
  tokens: number;
}
