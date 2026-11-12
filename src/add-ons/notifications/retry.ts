import { logging } from '@angular-devkit/core';
import { Tree } from '@angular-devkit/schematics';
import { addWorkerJob, hasFeature, hasWorker, WORKER_JOBS_MARKER, WORKER_MODULE } from '../../utils/ops';

/**
 * Push retry job shared by both install orders:
 * - `notifications` after `worker`: notifications registers it;
 * - `worker` after `notifications`: worker registers it (DEFERRED_JOBS).
 */
export const RETRY_JOB_FILE = 'apps/worker/src/jobs/notification-push-retry.job.ts';
export const NOTIFICATION_MODULE_FILE = 'libs/common/src/notifications/notification.module.ts';

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

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

export function hasNotifications(tree: Tree, root = ''): boolean {
  return hasFeature(tree, 'notifications', root) || tree.exists(prefixed(root, NOTIFICATION_MODULE_FILE));
}

/**
 * Adds NotificationPushRetryJob (and NotificationModule, push only) to the
 * worker when the worker app is there. Returns false, with a hint, when it is not.
 */
export function registerNotificationRetry(tree: Tree, logger: logging.LoggerApi, root = ''): boolean {
  if (!hasWorker(tree, root)) {
    if (tree.exists(prefixed(root, WORKER_MODULE))) {
      logger.warn(
        `${WORKER_MODULE} has no "${WORKER_JOBS_MARKER}" marker: register NotificationPushRetryJob ` +
          `(${RETRY_JOB_FILE}) and NotificationModule.forRoot({ channels: false }) there yourself.`,
      );
      if (!tree.exists(prefixed(root, RETRY_JOB_FILE))) tree.create(prefixed(root, RETRY_JOB_FILE), RETRY_JOB);
    } else {
      logger.info(
        'Failed pushes get a single attempt: run "npm run g -- worker" and the retry job ' +
          '(NOTIFICATION_PUSH_MAX_ATTEMPTS) is added automatically.',
      );
    }
    return false;
  }
  const path = prefixed(root, RETRY_JOB_FILE);
  if (!tree.exists(path)) tree.create(path, RETRY_JOB);
  const added = addWorkerJob(
    tree,
    'NotificationPushRetryJob',
    './jobs/notification-push-retry.job',
    {
      imports: [
        { className: 'NotificationModule', from: '@app/common/notifications', expression: 'NotificationModule.forRoot({ channels: false })' },
      ],
    },
    root,
  );
  if (added) logger.info(`Registered NotificationPushRetryJob (every minute, NOTIFICATION_PUSH_MAX_ATTEMPTS) in ${WORKER_MODULE}`);
  return added;
}
