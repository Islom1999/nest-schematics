import { logging } from '@angular-devkit/core';
import { Tree } from '@angular-devkit/schematics';
import { addWorkerJob, hasFeature, hasWorker, WORKER_JOBS_MARKER, WORKER_MODULE } from '../../utils/ops';

/**
 * Orphan cleanup job shared by both install orders:
 * - `upload` after `worker`: upload registers it;
 * - `worker` after `upload`: worker registers it (DEFERRED_JOBS).
 */
export const MEDIA_CLEANUP_JOB_FILE = 'apps/worker/src/jobs/media-cleanup.job.ts';
export const MEDIA_MODULE_FILE = 'libs/common/src/media/media.module.ts';

const CLEANUP_JOB = `import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MediaFilesService } from '@app/common/media';

/**
 * Deletes media files that are still unused (never attached to a record, or
 * released) UPLOAD_ORPHAN_HOURS (default 24, 0 = never) after the upload:
 * storage object, thumbnail and row. Files that a foreign key still
 * references are kept and marked used. Added by \`npm run g -- upload\`.
 */
@Injectable()
export class MediaCleanupJob {
  private readonly logger = new Logger(MediaCleanupJob.name);
  private running = false;

  constructor(private readonly media: MediaFilesService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'media-cleanup' })
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const deleted = await this.media.purgeOrphans();
      if (deleted) this.logger.log(\`Deleted \${deleted} unused media file(s)\`);
    } catch (error) {
      this.logger.error(\`Media cleanup failed: \${(error as Error).message}\`);
    } finally {
      this.running = false;
    }
  }
}
`;

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

export function hasUpload(tree: Tree, root = ''): boolean {
  return hasFeature(tree, 'upload', root) || tree.exists(prefixed(root, MEDIA_MODULE_FILE));
}

/**
 * Adds MediaCleanupJob (and MediaModule) to the worker when the worker app is
 * there. Returns false, with a hint, when it is not.
 */
export function registerMediaCleanup(tree: Tree, logger: logging.LoggerApi, root = ''): boolean {
  if (!hasWorker(tree, root)) {
    if (tree.exists(prefixed(root, WORKER_MODULE))) {
      logger.warn(
        `${WORKER_MODULE} has no "${WORKER_JOBS_MARKER}" marker: register MediaCleanupJob ` +
          `(${MEDIA_CLEANUP_JOB_FILE}) and MediaModule (@app/common/media) there yourself.`,
      );
      if (!tree.exists(prefixed(root, MEDIA_CLEANUP_JOB_FILE))) tree.create(prefixed(root, MEDIA_CLEANUP_JOB_FILE), CLEANUP_JOB);
    } else {
      logger.info(
        'Unused uploads are not deleted yet: run "npm run g -- worker" and the hourly cleanup job ' +
          '(UPLOAD_ORPHAN_HOURS) is added automatically.',
      );
    }
    return false;
  }
  const path = prefixed(root, MEDIA_CLEANUP_JOB_FILE);
  if (!tree.exists(path)) tree.create(path, CLEANUP_JOB);
  const added = addWorkerJob(
    tree,
    'MediaCleanupJob',
    './jobs/media-cleanup.job',
    { imports: [{ className: 'MediaModule', from: '@app/common/media' }] },
    root,
  );
  if (added) logger.info(`Registered MediaCleanupJob (hourly, UPLOAD_ORPHAN_HOURS) in ${WORKER_MODULE}`);
  return added;
}
