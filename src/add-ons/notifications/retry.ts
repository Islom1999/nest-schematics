import { logging } from '@angular-devkit/core';
import { Tree } from '@angular-devkit/schematics';
import {
  addModuleImport,
  addWorkerJob,
  hasFeature,
  hasWorker,
  removeWorkerJob,
  setModuleImport,
  WORKER_JOBS_MARKER,
  WORKER_MODULE,
} from '../../utils/ops';
import { hasQueue } from '../queue/wiring';

/**
 * Push retry job shared by both install orders:
 * - `notifications` after `worker`: notifications registers it;
 * - `worker` after `notifications`: worker registers it (DEFERRED_JOBS).
 * With the queue add-on there is no cron job: BullMQ retries the failed pushes
 * (see jobs.ts), and the worker gets the full NotificationModule instead.
 */
export const RETRY_JOB_FILE = 'apps/worker/src/jobs/notification-push-retry.job.ts';
export const NOTIFICATION_MODULE_FILE = 'libs/common/src/notifications/notification.module.ts';
const EMAIL_CHANNEL_FILE = 'libs/common/src/notifications/channels/email.channel.ts';

const RETRY_JOB = `import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationService } from '@app/common/notifications';

/**
 * Pushes failed notifications again with backoff (1, 2, 4... minutes, at most
 * an hour) until NOTIFICATION_PUSH_MAX_ATTEMPTS (default 5); read
 * notifications are not retried. Added by \`npm run g -- notifications\`.
 */
@Injectable()
export class NotificationPushRetryJob {
  private readonly logger = new Logger(NotificationPushRetryJob.name);
  private running = false;

  constructor(private readonly notifications: NotificationService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'notification-push-retry' })
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const retried = await this.notifications.retryFailedPushes();
      if (retried) this.logger.log(\`Retried \${retried} failed push(es)\`);
    } catch (error) {
      this.logger.error(\`Push retry failed: \${(error as Error).message}\`);
    } finally {
      this.running = false;
    }
  }
}
`;

/** Scheduled campaigns (`sendAt`) without the queue: a cron job in the worker; with the queue they are delayed jobs (jobs.ts). */
export const SCHEDULED_JOB_FILE = 'apps/worker/src/jobs/notification-scheduled.job.ts';

const SCHEDULED_JOB = `import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationService } from '@app/common/notifications';

/**
 * Sends the scheduled campaigns (admin broadcast with \`sendAt\`) whose time
 * has come, within a minute. Each campaign is claimed before it is sent, so
 * two workers never send it twice. Telegram and email are not available here
 * (the worker has push only): install the queue add-on for those. Added by
 * \`npm run g -- notifications\`.
 */
@Injectable()
export class NotificationScheduledJob {
  private readonly logger = new Logger(NotificationScheduledJob.name);
  private running = false;

  constructor(private readonly notifications: NotificationService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'notification-scheduled' })
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.notifications.dispatchDueCampaigns();
      if (sent) this.logger.log(\`Sent \${sent} scheduled campaign(s)\`);
    } catch (error) {
      this.logger.error(\`Scheduled campaigns failed: \${(error as Error).message}\`);
    } finally {
      this.running = false;
    }
  }
}
`;

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

export function hasNotifications(tree: Tree, root = ''): boolean {
  return hasFeature(tree, 'notifications', root) || tree.exists(prefixed(root, NOTIFICATION_MODULE_FILE));
}

/**
 * With the queue: no cron job. The worker (when there is one) runs the jobs, so
 * it gets NotificationModule with the channels (not push only), plus
 * MailModule for the email channel; a cron job from an earlier install is
 * removed. Returns false: no cron job is registered.
 */
function useQueueRetries(tree: Tree, logger: logging.LoggerApi, root: string): false {
  if (!hasWorker(tree, root)) return false;
  const worker = prefixed(root, WORKER_MODULE);
  if (removeWorkerJob(tree, 'NotificationPushRetryJob', root)) {
    const file = prefixed(root, RETRY_JOB_FILE);
    if (tree.exists(file)) tree.delete(file);
    logger.info('Notifications: NotificationPushRetryJob removed, failed pushes are retried by the queue (BullMQ).');
  }
  if (removeWorkerJob(tree, 'NotificationScheduledJob', root)) {
    const file = prefixed(root, SCHEDULED_JOB_FILE);
    if (tree.exists(file)) tree.delete(file);
    logger.info('Notifications: NotificationScheduledJob removed, scheduled campaigns are delayed jobs of the queue (BullMQ).');
  }
  addModuleImport(tree, worker, 'NotificationModule', '@app/common/notifications', 'NotificationModule.forRoot()');
  setModuleImport(tree, worker, 'NotificationModule', 'NotificationModule.forRoot()');
  if (tree.exists(prefixed(root, EMAIL_CHANNEL_FILE))) addModuleImport(tree, worker, 'MailModule', '@app/common');
  return false;
}

/**
 * Adds NotificationPushRetryJob and NotificationScheduledJob (and NotificationModule, push only) to the
 * worker when the worker app is there. Returns false, with a hint, when it is not.
 * With the queue installed it wires the queue retries instead (see above).
 */
export function registerNotificationRetry(tree: Tree, logger: logging.LoggerApi, root = ''): boolean {
  if (hasQueue(tree, root)) return useQueueRetries(tree, logger, root);
  if (!hasWorker(tree, root)) {
    if (tree.exists(prefixed(root, WORKER_MODULE))) {
      logger.warn(
        `${WORKER_MODULE} has no "${WORKER_JOBS_MARKER}" marker: register NotificationPushRetryJob ` +
          `(${RETRY_JOB_FILE}), NotificationScheduledJob (${SCHEDULED_JOB_FILE}) and NotificationModule.forRoot({ channels: false }) there yourself.`,
      );
      if (!tree.exists(prefixed(root, RETRY_JOB_FILE))) tree.create(prefixed(root, RETRY_JOB_FILE), RETRY_JOB);
      if (!tree.exists(prefixed(root, SCHEDULED_JOB_FILE))) tree.create(prefixed(root, SCHEDULED_JOB_FILE), SCHEDULED_JOB);
    } else {
      logger.info(
        'Failed pushes get a single attempt, and scheduled campaigns (sendAt) are not sent: run "npm run g -- worker" ' +
          '(or add the queue) and the retry and scheduling jobs are added automatically.',
      );
    }
    return false;
  }
  const path = prefixed(root, RETRY_JOB_FILE);
  if (!tree.exists(path)) tree.create(path, RETRY_JOB);
  const imports = [
    { className: 'NotificationModule', from: '@app/common/notifications', expression: 'NotificationModule.forRoot({ channels: false })' },
  ];
  const scheduled = prefixed(root, SCHEDULED_JOB_FILE);
  if (!tree.exists(scheduled)) tree.create(scheduled, SCHEDULED_JOB);
  addWorkerJob(tree, 'NotificationScheduledJob', './jobs/notification-scheduled.job', { imports }, root);
  const added = addWorkerJob(tree, 'NotificationPushRetryJob', './jobs/notification-push-retry.job', { imports }, root);
  if (added) logger.info(`Registered NotificationPushRetryJob (every minute, NOTIFICATION_PUSH_MAX_ATTEMPTS) in ${WORKER_MODULE}`);
  return added;
}
