import { Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty } from '@nestjs/swagger';
import { AdminAccess, apiEnum, JobsService } from '@app/common';
import { AdminResource } from '../../auth';

export enum QueueDriverName {
  redis = 'redis',
  memory = 'memory',
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

/** `/api/admin/queues`: job counts per queue (permission `queue.read`). */
@AdminResource('queues', { read: ['queue.read'], write: [] })
export class QueuesAdminController {
  constructor(private readonly jobs: JobsService) {}

  @AdminAccess('read')
  @Get()
  @ApiOperation({ summary: 'Queue driver and job counts per queue (waiting, active, delayed, completed, failed)' })
  @ApiOkResponse({ type: QueuesStatusDto })
  async status(): Promise<QueuesStatusDto> {
    return { driver: this.jobs.driver as QueueDriverName, queues: await this.jobs.stats() };
  }
}
