import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

export enum ServerApiLogType {
  API = 'API',
  PAYMENT = 'PAYMENT',
  CRON = 'CRON',
  AUTH = 'AUTH',
}

/**
 * One logged HTTP request, payment call or cron run (`npm run g -- api-logs`).
 * Rows are written by ApiLogInterceptor, `@LogPayment()` and
 * `ApiLogService.logCron()`; bodies are masked and truncated before they get
 * here. The worker deletes rows older than API_LOG_RETENTION_DAYS.
 * Schema: migration `*-server-api-logs.ts` (keep both in sync).
 */
@Entity({ name: 'server_api_logs' })
@Index('IDX_server_api_logs_created_at', ['createdAt'])
export class ServerApiLog extends BaseEntity {
  @ApiProperty({ enum: ServerApiLogType, enumName: 'ServerApiLogType' })
  @Index('IDX_server_api_logs_type')
  @Column({ type: 'varchar', length: 16, default: ServerApiLogType.API })
  type: ServerApiLogType;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Controller, payment provider or job class' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  module: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Route handler or cron job name' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  handler: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'POST' })
  @Column({ type: 'varchar', length: 10, nullable: true })
  method: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Path and query (secret parameters masked)' })
  @Column({ type: 'text', nullable: true })
  url: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @Index('IDX_server_api_logs_status_code')
  @Column({ type: 'int', nullable: true })
  statusCode: number | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: 'Masked, truncated' })
  @Column({ type: 'jsonb', nullable: true })
  requestBody: unknown;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: 'Masked, truncated' })
  @Column({ type: 'jsonb', nullable: true })
  responseBody: unknown;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'From the verified token (request.user)' })
  @Index('IDX_server_api_logs_user_id')
  @Column({ type: 'varchar', length: 64, nullable: true })
  userId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'admin' })
  @Column({ type: 'varchar', length: 32, nullable: true })
  userType: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'x-request-id header' })
  @Index('IDX_server_api_logs_request_id')
  @Column({ type: 'varchar', length: 64, nullable: true })
  requestId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'API_LOG_SERVER_ID or host name' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  serverId: string | null;
}
