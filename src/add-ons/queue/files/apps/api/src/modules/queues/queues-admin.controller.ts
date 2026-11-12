import { Body, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AdminAccess, apiEnum, JobsService } from '@app/common';
import type { CleanableStatus, JobStatus } from '@app/common';
import { AdminResource } from '../../auth';

export enum QueueDriverName {
  redis = 'redis',
  memory = 'memory',
}

/** Same values as `JobStatus` (a TypeScript enum, so Swagger names it). */
export enum QueueJobStatus {
  waiting = 'waiting',
  active = 'active',
  delayed = 'delayed',
  completed = 'completed',
  failed = 'failed',
}

/** Same values as `CleanableStatus`. */
export enum QueueCleanStatus {
  completed = 'completed',
  failed = 'failed',
  delayed = 'delayed',
  waiting = 'waiting',
}

export class QueueCountsDto {
  @ApiProperty({ type: String, example: 'default' })
  name: string;

  @ApiProperty({ type: Number })
  waiting: number;

  @ApiProperty({ type: Number })
  active: number;

  @ApiProperty({ type: Number })
  delayed: number;

  @ApiProperty({ type: Number })
  completed: number;

  @ApiProperty({ type: Number })
  failed: number;

  @ApiProperty({ type: Boolean, description: 'Workers take no new jobs (POST :queue/pause)' })
  paused: boolean;
}

export class QueuesStatusDto {
  @ApiProperty({
    ...apiEnum(QueueDriverName, 'QueueDriverName'),
    description: 'redis = BullMQ; memory = in-process fallback without REDIS_URL (jobs are lost on restart)',
  })
  driver: QueueDriverName;

  @ApiProperty({ type: QueueCountsDto, isArray: true })
  queues: QueueCountsDto[];
}

export class QueueJobsQueryDto {
  @ApiProperty({ ...apiEnum(QueueJobStatus, 'QueueJobStatus') })
  @IsEnum(QueueJobStatus)
  status: JobStatus;

  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class QueueJobDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, example: 'mail.send' })
  name: string;

  @ApiProperty({ type: String, example: 'default' })
  queue: string;

  @ApiProperty({ ...apiEnum(QueueJobStatus, 'QueueJobStatus') })
  status: JobStatus;

  @ApiProperty({ description: 'Job payload; values of keys like password, token, otp or code are shown as ***, long text is cut' })
  data: unknown;

  @ApiProperty({ type: Number, description: 'Runs started so far' })
  attemptsMade: number;

  @ApiProperty({ type: Number, nullable: true, description: 'Runs allowed, including the first' })
  attempts: number | null;

  @ApiProperty({ type: String, nullable: true })
  failedReason: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  createdAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  processedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt: string | null;
}

export class QueueJobsPageDto {
  @ApiProperty({ type: Number, description: 'Jobs in that state in total' })
  count: number;

  @ApiProperty({ type: QueueJobDto, isArray: true })
  data: QueueJobDto[];
}

export class CleanQueueDto {
  @ApiProperty({ ...apiEnum(QueueCleanStatus, 'QueueCleanStatus'), description: 'Active jobs cannot be cleaned' })
  @IsEnum(QueueCleanStatus)
  status: CleanableStatus;

  @ApiProperty({ type: Number, minimum: 0, description: 'Only jobs at least this old (ms); 0 = all jobs in that state' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  olderThanMs: number;
}

export class CleanQueueResultDto {
  @ApiProperty({ type: Number })
  removed: number;
}

export class QueueActionResultDto {
  @ApiProperty({ type: Boolean, example: true })
  success: boolean;
}

export class QueuePausedDto {
  @ApiProperty({ type: String, example: 'default' })
  name: string;

  @ApiProperty({ type: Boolean })
  paused: boolean;
}

/**
 * `/api/admin/queues`: job counts per queue and job control (reads need
 * `queue.read`, retry / clean / pause / resume need `queue.write`). Works for
 * both drivers (redis = BullMQ, memory = in-process).
 */
@AdminResource('queues', { read: ['queue.read'], write: ['queue.write'] })
export class QueuesAdminController {
  constructor(private readonly jobs: JobsService) {}

  @AdminAccess('read')
  @Get()
  @ApiOperation({ summary: 'Queue driver and job counts per queue (waiting, active, delayed, completed, failed, paused)' })
  @ApiOkResponse({ type: QueuesStatusDto })
  async status(): Promise<QueuesStatusDto> {
    return { driver: this.jobs.driver as QueueDriverName, queues: await this.jobs.stats() };
  }

  @AdminAccess('read')
  @Get(':queue/jobs')
  @ApiOperation({ summary: 'Jobs of one queue in one state, newest first (?status=&page=&limit=)' })
  @ApiOkResponse({ type: QueueJobsPageDto })
  async jobsOf(@Param('queue') queue: string, @Query() query: QueueJobsQueryDto): Promise<QueueJobsPageDto> {
    return this.jobs.listJobs(queue, query.status, query.page, query.limit);
  }

  @AdminAccess('write')
  @HttpCode(HttpStatus.OK)
  @Post(':queue/jobs/:id/retry')
  @ApiOperation({ summary: 'Run a failed job again (409 when it is not failed)' })
  @ApiOkResponse({ type: QueueActionResultDto })
  async retry(@Param('queue') queue: string, @Param('id') id: string): Promise<QueueActionResultDto> {
    await this.jobs.retryJob(queue, id);
    return { success: true };
  }

  @AdminAccess('write')
  @HttpCode(HttpStatus.OK)
  @Post(':queue/clean')
  @ApiOperation({ summary: 'Remove jobs of one state that are older than olderThanMs' })
  @ApiOkResponse({ type: CleanQueueResultDto })
  async clean(@Param('queue') queue: string, @Body() dto: CleanQueueDto): Promise<CleanQueueResultDto> {
    return { removed: await this.jobs.clean(queue, dto.status, dto.olderThanMs) };
  }

  @AdminAccess('write')
  @HttpCode(HttpStatus.OK)
  @Post(':queue/pause')
  @ApiOperation({ summary: 'Stop taking new jobs; running jobs finish' })
  @ApiOkResponse({ type: QueuePausedDto })
  async pause(@Param('queue') queue: string): Promise<QueuePausedDto> {
    await this.jobs.pauseQueue(queue);
    return { name: queue, paused: true };
  }

  @AdminAccess('write')
  @HttpCode(HttpStatus.OK)
  @Post(':queue/resume')
  @ApiOperation({ summary: 'Take jobs again' })
  @ApiOkResponse({ type: QueuePausedDto })
  async resume(@Param('queue') queue: string): Promise<QueuePausedDto> {
    await this.jobs.resumeQueue(queue);
    return { name: queue, paused: false };
  }
}
