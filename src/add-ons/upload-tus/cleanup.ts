import { logging } from '@angular-devkit/core';
import { Tree } from '@angular-devkit/schematics';
import { addWorkerJob, hasFeature, hasWorker, WORKER_JOBS_MARKER, WORKER_MODULE } from '../../utils/ops';

/**
 * Cleanup of unfinished resumable uploads, shared by both install orders:
 * - `upload-tus` after `worker`: upload-tus registers it;
 * - `worker` after `upload-tus`: worker registers it (DEFERRED_JOBS).
 */
export const TUS_CLEANUP_JOB_FILE = 'apps/worker/src/jobs/tus-cleanup.job.ts';
export const TUS_LIB_FILE = 'libs/common/src/media/tus/index.ts';

const CLEANUP_JOB = `import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { purgeExpiredTusUploads, readTusSettings } from '@app/common/media/tus';

/**
 * Deletes unfinished resumable uploads (TUS_DIR) that nobody wrote to for
 * TUS_EXPIRE_HOURS (default 24, 0 = never), with their info files and old
 * results. The worker needs the same TUS_DIR as the api (same host or the
 * same volume). Added by \`npm run g -- upload-tus\`.
 */
@Injectable()
export class TusCleanupJob {
  private readonly logger = new Logger(TusCleanupJob.name);
  private running = false;

  constructor(private readonly config: ConfigService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'tus-cleanup' })
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const { dir, expireHours } = readTusSettings(this.config);
      const deleted = await purgeExpiredTusUploads(dir, expireHours);
      if (deleted) this.logger.log(\`Deleted \${deleted} unfinished upload(s) from \${dir}\`);
    } catch (error) {
      this.logger.error(\`tus cleanup failed: \${(error as Error).message}\`);
    } finally {
      this.running = false;
    }
  }
}
`;

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

export function hasUploadTus(tree: Tree, root = ''): boolean {
  return hasFeature(tree, 'upload-tus', root) || tree.exists(prefixed(root, TUS_LIB_FILE));
}

/**
 * Adds TusCleanupJob to the worker when the worker app is there. Returns
 * false, with a hint, when it is not.
 */
export function registerTusCleanup(tree: Tree, logger: logging.LoggerApi, root = ''): boolean {
  if (!hasWorker(tree, root)) {
    if (tree.exists(prefixed(root, WORKER_MODULE))) {
      logger.warn(
        `${WORKER_MODULE} has no "${WORKER_JOBS_MARKER}" marker: register TusCleanupJob ` +
          `(${TUS_CLEANUP_JOB_FILE}) there yourself.`,
      );
      if (!tree.exists(prefixed(root, TUS_CLEANUP_JOB_FILE))) tree.create(prefixed(root, TUS_CLEANUP_JOB_FILE), CLEANUP_JOB);
    } else {
      logger.info(
        'Unfinished uploads are not deleted yet: run "npm run g -- worker" and the hourly cleanup job ' +
          '(TUS_EXPIRE_HOURS) is added automatically.',
      );
    }
    return false;
  }
  const path = prefixed(root, TUS_CLEANUP_JOB_FILE);
  if (!tree.exists(path)) tree.create(path, CLEANUP_JOB);
  const added = addWorkerJob(tree, 'TusCleanupJob', './jobs/tus-cleanup.job', {}, root);
  if (added) logger.info(`Registered TusCleanupJob (hourly, TUS_EXPIRE_HOURS) in ${WORKER_MODULE}`);
  return added;
}
