import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

/** Example job: checks the database on start and every hour. Add your own jobs next to it. */
@Injectable()
export class WorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkerService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap() {
    await this.heartbeat();
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'heartbeat' })
  async heartbeat() {
    try {
      await this.dataSource.query('SELECT 1');
      this.logger.log('heartbeat: database reachable');
    } catch (e) {
      this.logger.error(`heartbeat: database unreachable (${(e as Error).message})`);
    }
  }
}
