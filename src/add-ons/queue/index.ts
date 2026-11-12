import { Rule, SchematicContext, Tree, apply, chain, move, noop, url } from '@angular-devkit/schematics';
import {
  addBarrelExport,
  addModuleImport,
  addPackageJson,
  addPermissions,
  getProject,
  hasWorker,
  mergeSafe,
  recordFeature,
  requireFeatures,
  scheduleInstall,
} from '../../utils/ops';
import { registerNotificationJobs } from '../notifications/jobs';
import { Schema } from './schema';
import { wireQueueProcessors } from './wiring';

export const QUEUE_DEPENDENCIES = {
  bullmq: '^5.81.0',
  '@nestjs/bullmq': '^11.0.5',
};

/**
 * `npm run g -- queue` (needs redis): BullMQ via @nestjs/bullmq in
 * libs/common/src/queue — QueueModule.forRoot()/forFeature(), the generic
 * `JobsService.enqueue(name, data, opts)` (3 attempts, exponential backoff),
 * `@JobHandler()` processors and `GET admin/queues`. Jobs run in apps/worker
 * when it is installed (before or after this add-on), otherwise in the api.
 * Without REDIS_URL an in-memory driver keeps the app working.
 */
export function queue(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const root = options.root ?? '';
    const project = getProject(tree, root);
    requireFeatures(tree, 'queue', ['redis'], root);
    const files = apply(url('./files'), [root ? move(root) : noop()]);

    const wire: Rule = (host: Tree) => {
      addBarrelExport(host, `${project.commonSrc}/index.ts`, 'queue');
      wireQueueProcessors(host, context.logger, root);
      addModuleImport(host, project.apiModule, 'QueuesAdminModule', './modules/queues/queues-admin.module');
      addPermissions(host, 'queue', ['read'], root);
      addPackageJson(host, { dependencies: QUEUE_DEPENDENCIES }, root);
      recordFeature(host, 'queue', {}, undefined, root);
      // notifications installed first: its work moves onto jobs
      registerNotificationJobs(host, context.logger, root);
      scheduleInstall(context, options.skipInstall, root);
      return host;
    };

    return chain([
      mergeSafe(files, options.force),
      wire,
      (host: Tree, ctx: SchematicContext) => {
        ctx.logger.info(
          'Queue: jobs.enqueue(name, data, opts) from JobsService (@app/common), handlers with @JobHandler(name). ' +
            (hasWorker(host, root)
              ? 'Jobs run in apps/worker (add handler providers to WorkerModule).'
              : 'Jobs run in the api; after "npm run g -- worker" they move to apps/worker.') +
            ' Admin: GET /api/admin/queues (queue.read).',
        );
      },
    ]);
  };
}
