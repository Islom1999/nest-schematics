import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

/** Example scheduled jobs — replace with real ones. */
@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);

  constructor(private readonly dataSource: DataSource) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'heartbeat' })
  async heartbeat() {
    await this.dataSource.query('SELECT 1');
    this.logger.log('heartbeat: database reachable');
  }
}
