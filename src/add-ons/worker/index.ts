import { Rule, SchematicContext, Tree, apply, chain, move, noop, url } from '@angular-devkit/schematics';
import {
  addNestApp,
  addPackageJson,
  getProject,
  mergeSafe,
  recordFeature,
  scheduleInstall,
} from '../../utils/ops';
import { hasApiLogs, registerApiLogCleanup } from '../api-logs/cleanup';
import { Schema } from './schema';

/**
 * Jobs of add-ons that can be installed before the worker. Each add-on that
 * registers a cron job with `addWorkerJob` when the worker exists adds one
 * entry here, so installing the worker later wires the job too.
 */
interface DeferredJob {
  installed: (tree: Tree, root: string) => boolean;
  register: (tree: Tree, logger: SchematicContext['logger'], root: string) => void;
}

const DEFERRED_JOBS: DeferredJob[] = [
  { installed: hasApiLogs, register: registerApiLogCleanup },
];

/**
 * `npm run g -- worker`: apps/worker, a Nest application context with
 * `@nestjs/schedule`. Other add-ons register their cron jobs in WorkerModule
 * with `addWorkerJob` (marker `// @ns:worker-jobs`); add-ons installed before
 * the worker are wired here (api-logs → daily cleanup job).
 */
export function worker(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const root = options.root ?? '';
    getProject(tree, root);

    const files = apply(url('./files'), [root ? move(root) : noop()]);

    const wire: Rule = (host: Tree) => {
      const result = addNestApp(host, 'worker', root);
      if (result.buildCustomised) {
        context.logger.warn('package.json "build" is customised: add "nest build worker" to it yourself.');
      }
      addPackageJson(host, { dependencies: { '@nestjs/schedule': '^6.0.0' } }, root);
      for (const job of DEFERRED_JOBS) {
        if (job.installed(host, root)) job.register(host, context.logger, root);
      }
      recordFeature(host, 'worker', {}, undefined, root);
      scheduleInstall(context, options.skipInstall, root);
      return host;
    };

    return chain([
      mergeSafe(files, options.force),
      wire,
      (_host: Tree, ctx: SchematicContext) => {
        if (root) return;
        ctx.logger.info('Worker: npm run start:dev:worker (jobs in apps/worker/src, register them in WorkerModule).');
      },
    ]);
  };
}
