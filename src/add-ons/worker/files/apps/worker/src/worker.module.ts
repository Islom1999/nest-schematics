import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from '@app/common';
import { DatabaseModule } from '@app/database';
import { WorkerService } from './worker.service';

/**
 * Background jobs (`@Cron`). Add-ons register their job classes in `providers`
 * above the `@ns:worker-jobs` marker (keep the marker). A job that needs
 * repositories imports a feature module here, or uses DataSource directly.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    DatabaseModule,
  ],
  providers: [
    WorkerService,
    // @ns:worker-jobs
  ],
})
export class WorkerModule {}
