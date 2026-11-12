import { logging } from '@angular-devkit/core';
import { Tree } from '@angular-devkit/schematics';
import { addWorkerJob, hasFeature, hasWorker, WORKER_JOBS_MARKER, WORKER_MODULE } from '../../utils/ops';

/**
 * Retention job shared by both install orders:
 * - `api-logs` after `worker`: api-logs registers it;
 * - `worker` after `api-logs`: worker registers it.
 */
export const CLEANUP_JOB_FILE = 'apps/worker/src/jobs/api-log-cleanup.job.ts';
export const API_LOG_MODULE_FILE = 'libs/common/src/logging/api-log.module.ts';

const CLEANUP_JOB = `import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiLogService } from '@app/common';

/**
 * Deletes server_api_logs rows older than API_LOG_RETENTION_DAYS (default 30,
 * 0 = keep forever) every night, in batches. Each run is logged as CRON.
 * Added by \`npm run g -- api-logs\`.
 */
@Injectable()
export class ApiLogCleanupJob {
  constructor(private readonly apiLogs: ApiLogService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'api-log-cleanup' })
  async run() {
    await this.apiLogs.logCron(ApiLogCleanupJob.name, 'api-log-cleanup', async () => ({
      deleted: await this.apiLogs.purgeExpired(),
    }));
  }
}
`;

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

export function hasApiLogs(tree: Tree, root = ''): boolean {
  return hasFeature(tree, 'api-logs', root) || tree.exists(prefixed(root, API_LOG_MODULE_FILE));
}

/**
 * Adds ApiLogCleanupJob (and ApiLogModule) to the worker when the worker app
 * is there. Returns false, with a hint, when it is not.
 */
export function registerApiLogCleanup(tree: Tree, logger: logging.LoggerApi, root = ''): boolean {
  if (!hasWorker(tree, root)) {
    if (tree.exists(prefixed(root, WORKER_MODULE))) {
      logger.warn(
        `${WORKER_MODULE} has no "${WORKER_JOBS_MARKER}" marker: register ApiLogCleanupJob ` +
          `(${CLEANUP_JOB_FILE}) and ApiLogModule there yourself.`,
      );
      if (!tree.exists(prefixed(root, CLEANUP_JOB_FILE))) tree.create(prefixed(root, CLEANUP_JOB_FILE), CLEANUP_JOB);
    } else {
      logger.info(
        'Old logs are not deleted yet: run "npm run g -- worker" and the daily cleanup job ' +
          '(API_LOG_RETENTION_DAYS) is added automatically.',
      );
    }
    return false;
  }
  const path = prefixed(root, CLEANUP_JOB_FILE);
  if (!tree.exists(path)) tree.create(path, CLEANUP_JOB);
  const added = addWorkerJob(
    tree,
    'ApiLogCleanupJob',
    './jobs/api-log-cleanup.job',
    { imports: [{ className: 'ApiLogModule', from: '@app/common' }] },
    root,
  );
  if (added) logger.info(`Registered ApiLogCleanupJob (daily, API_LOG_RETENTION_DAYS) in ${WORKER_MODULE}`);
  return added;
}
