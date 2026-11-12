import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * AI chat usage of one user on one UTC day (`npm run g -- ai --quota`).
 * Counters are incremented with atomic upserts. Schema: migration `*-ai-quota.ts`.
 */
@Entity({ name: 'ai_usage_daily' })
@Index('UQ_ai_usage_daily_user_id_day', ['userId', 'day'], { unique: true })
export class AiUsageDaily extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'varchar', length: 64 })
  userId: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-01-31' })
  @Column({ type: 'date' })
  day: string;

  @ApiProperty({ type: Number })
  @Column({ type: 'int', default: 0 })
  messages: number;

  @ApiProperty({ type: Number })
  @Column({ type: 'int', default: 0 })
  tokens: number;
}
