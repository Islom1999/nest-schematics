import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from '@app/common';
import { DatabaseModule } from '@app/database';
import { WorkerService } from './worker.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    // TypeOrmModule.forFeature([SomeEntity]) for the entities the jobs use
  ],
  providers: [WorkerService],
})
export class WorkerModule {}
