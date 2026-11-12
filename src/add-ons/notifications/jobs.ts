import { logging } from '@angular-devkit/core';
import { Tree } from '@angular-devkit/schematics';
import { hasQueue, registerJobHandlers } from '../queue/wiring';
import { hasNotifications, registerNotificationRetry } from './retry';

/**
 * Notifications on BullMQ jobs, shared by both install orders:
 * - `notifications` after `queue`: notifications wires it;
 * - `queue` after `notifications`: queue wires it.
 * The module is not in the notifications barrel (it needs the queue); it is
 * imported by its own path.
 */
export const JOBS_MODULE_FILE = 'libs/common/src/notifications/notification-jobs.module.ts';
export const JOBS_MODULE_FROM = '@app/common/notifications/notification-jobs.module';

const JOBS_MODULE = `import { Global, Injectable, Module } from '@nestjs/common';
import { JobHandler, JobsService } from '../queue';
import { NotificationService } from './notification.service';
import {
  BroadcastJobData,
  ChannelJobData,
  NOTIFICATION_JOB,
  NOTIFICATION_JOBS,
  NOTIFICATION_QUEUE,
  PushRetryJobData,
} from './notification.types';

/**
 * Notification jobs (queue "notifications"). Added by \`npm run g -- queue\` or
 * \`npm run g -- notifications\`, whichever comes second. They run in apps/worker
 * when it exists, otherwise in the api.
 */
@Injectable()
export class NotificationJobs {
  constructor(private readonly notifications: NotificationService) {}

  /** One batch of users for telegram or email. A throw is retried with backoff (3 attempts). */
  @JobHandler(NOTIFICATION_JOB.channel, { queue: NOTIFICATION_QUEUE, concurrency: 2 })
  channel(data: ChannelJobData): Promise<void> {
    return this.notifications.deliverChannel(data.channel, data.userIds, data.payload);
  }

  /** \`send('all', ...)\`: every user in batches, then the campaign totals. Not retried: it would save the rows twice. */
  @JobHandler(NOTIFICATION_JOB.broadcast, { queue: NOTIFICATION_QUEUE })
  async broadcast(data: BroadcastJobData): Promise<void> {
    await this.notifications.runBroadcast(data.payload, data.options);
  }

  /** Failed pushes again; throws while some still fail, so the queue retries with backoff (NOTIFICATION_PUSH_MAX_ATTEMPTS). */
  @JobHandler(NOTIFICATION_JOB.pushRetry, { queue: NOTIFICATION_QUEUE })
  async pushRetry(data: PushRetryJobData): Promise<void> {
    await this.notifications.retryPush(data.ids);
  }
}

/** Gives NotificationService the queue (global, like the module that uses it) and registers the jobs. */
@Global()
@Module({
  providers: [NotificationJobs, { provide: NOTIFICATION_JOBS, useExisting: JobsService }],
  exports: [NOTIFICATION_JOBS],
})
export class NotificationJobsModule {}
`;

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

/**
 * When notifications and queue are both installed: adds NotificationJobsModule
 * (api, and worker when there is one), and replaces the cron retry job with
 * queue retries. Does nothing otherwise; safe to call again.
 *
 * @returns whether the jobs are wired.
 */
export function registerNotificationJobs(tree: Tree, logger: logging.LoggerApi, root = ''): boolean {
  if (!hasNotifications(tree, root) || !hasQueue(tree, root)) return false;
  const path = prefixed(root, JOBS_MODULE_FILE);
  if (!tree.exists(path)) tree.create(path, JOBS_MODULE);
  registerJobHandlers(tree, 'NotificationJobsModule', JOBS_MODULE_FROM, root);
  registerNotificationRetry(tree, logger, root);
  return true;
}
