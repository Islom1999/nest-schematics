import { logging } from '@angular-devkit/core';
import { Tree } from '@angular-devkit/schematics';
import {
  addModuleImport,
  getProject,
  hasFeature,
  hasWorker,
  readManifest,
  recordFeature,
  setModuleImport,
  WORKER_MODULE,
} from '../../utils/ops';

/**
 * Where jobs run, shared by both install orders (queue ↔ worker):
 * - without apps/worker: the api runs the `@JobHandler`s (`QueueModule.forRoot()`);
 * - with it: the api only enqueues (`forRoot({ processors: false })`) and the
 *   worker imports `QueueModule.forRoot()` and every handler module.
 */
export const QUEUE_MODULE_FILE = 'libs/common/src/queue/queue.module.ts';
export const API_QUEUE_IMPORT = 'QueueModule.forRoot()';
export const API_QUEUE_IMPORT_WITH_WORKER = 'QueueModule.forRoot({ processors: false })';
export const WORKER_QUEUE_IMPORT = 'QueueModule.forRoot()';

const HANDLER_ITEM = 'handlers:';

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

export function hasQueue(tree: Tree, root = ''): boolean {
  return hasFeature(tree, 'queue', root) || tree.exists(prefixed(root, QUEUE_MODULE_FILE));
}

/** Handler modules registered with {@link registerJobHandlers}: `[className, from]`. */
function handlerModules(tree: Tree, root: string): [string, string][] {
  const items = readManifest(tree, root)?.features['queue']?.items ?? [];
  return items
    .filter((i) => i.startsWith(HANDLER_ITEM))
    .map((i) => i.slice(HANDLER_ITEM.length).split('|') as [string, string]);
}

/**
 * Puts QueueModule (and the registered handler modules) where the jobs should
 * run. Safe to call again; called by the queue add-on and by the worker add-on.
 */
export function wireQueueProcessors(tree: Tree, logger: logging.LoggerApi, root = ''): void {
  const project = getProject(tree, root);
  if (!hasWorker(tree, root)) {
    addModuleImport(tree, project.apiModule, 'QueueModule', '@app/common', API_QUEUE_IMPORT);
    return;
  }
  const worker = prefixed(root, WORKER_MODULE);
  addModuleImport(tree, project.apiModule, 'QueueModule', '@app/common', API_QUEUE_IMPORT_WITH_WORKER);
  if (setModuleImport(tree, project.apiModule, 'QueueModule', API_QUEUE_IMPORT_WITH_WORKER)) {
    logger.info('Queue: jobs now run in apps/worker; the api only enqueues (QueueModule.forRoot({ processors: false })).');
  }
  addModuleImport(tree, worker, 'QueueModule', '@app/common', WORKER_QUEUE_IMPORT);
  for (const [className, from] of handlerModules(tree, root)) {
    addModuleImport(tree, worker, className, from);
  }
}

/**
 * For add-ons with `@JobHandler`s (mail, notifications, ai...): imports their
 * module (`from` must resolve from both apps, e.g. `@app/common`) into the api
 * and, when installed, the worker; remembers it so a worker added later
 * imports it too. Requires the queue feature.
 */
export function registerJobHandlers(tree: Tree, className: string, from: string, root = ''): void {
  const project = getProject(tree, root);
  addModuleImport(tree, project.apiModule, className, from);
  if (hasWorker(tree, root)) addModuleImport(tree, prefixed(root, WORKER_MODULE), className, from);
  recordFeature(tree, 'queue', {}, `${HANDLER_ITEM}${className}|${from}`, root);
}
