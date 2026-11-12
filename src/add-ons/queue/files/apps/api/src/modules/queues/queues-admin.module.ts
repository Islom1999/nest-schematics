import { Module } from '@nestjs/common';
import { QueuesAdminController } from './queues-admin.controller';

/** Admin view of the job queues (`npm run g -- queue`). JobsService comes from the global QueueModule. */
@Module({
  controllers: [QueuesAdminController],
})
export class QueuesAdminModule {}
