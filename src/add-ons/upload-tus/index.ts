import {
  Rule,
  SchematicContext,
  Source,
  Tree,
  apply,
  applyTemplates,
  chain,
  filter,
  move,
  noop,
  url,
} from '@angular-devkit/schematics';
import {
  addComposeService,
  addComposeServiceEntry,
  addEnv,
  addModuleController,
  addModuleImport,
  addModuleProvider,
  addPackageJson,
  getProject,
  hasFeature,
  mergeSafe,
  readManifest,
  recordFeature,
  requireFeatures,
  scheduleInstall,
} from '../../utils/ops';
import { CLIENT_AUTH_FEATURE } from '../upload';
import { registerTusCleanup } from './cleanup';
import { Schema } from './schema';

export type TusEngine = 'tusd' | 'node';

const TUS_MODULE_FILE = 'apps/api/src/modules/tus/tus.module.ts';
/** Created once, then only edited through ops (engines and the user verifier are added to it). */
const CREATE_ONLY = [TUS_MODULE_FILE];

/** Pinned tusd image (https://hub.docker.com/r/tusproject/tusd/tags). */
export const TUSD_IMAGE = 'tusproject/tusd:v2.10.1';
/** Where tusd keeps uploads, and where the api container mounts the same volume (TUS_DIR). */
export const TUSD_DATA_DIR = '/srv/tusd-data';
export const TUS_HOOKS_PATH = '/api/internal/tus-hooks';

export const TUS_PACKAGES = { '@tus/server': '^2.4.7', '@tus/file-store': '^2.1.2' };

const TUSD_SERVICE = `image: ${TUSD_IMAGE}
restart: unless-stopped
# Upload endpoint for clients: http://localhost:\${TUSD_PORT:-8080}/files/ (put it behind your proxy).
# The proxy sets X-Tus-Hook-Secret (= TUS_HOOK_SECRET) on requests to tusd; tusd forwards it to the hooks.
command:
  - -behind-proxy
  - -base-path=/files/
  - -upload-dir=${TUSD_DATA_DIR}
  - -disable-download
  - -disable-concatenation
  - -hooks-http=http://api:3000${TUS_HOOKS_PATH}
  - -hooks-http-forward-headers=X-Tus-Hook-Secret
  - -hooks-enabled-events=pre-create,post-finish
ports:
  - "\${TUSD_PORT:-8080}:8080"
volumes:
  - tus-data:${TUSD_DATA_DIR}`;

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

function previousEngines(tree: Tree, root: string): { engine?: TusEngine; installed: TusEngine[] } {
  const feature = readManifest(tree, root)?.features['upload-tus'];
  const engine = feature?.options?.['engine'];
  const installed = (feature?.items ?? []).filter((i): i is TusEngine => i === 'tusd' || i === 'node');
  return { engine: engine === 'node' || engine === 'tusd' ? engine : undefined, installed };
}

/**
 * `npm run g -- upload-tus [--engine tusd|node]`: resumable (tus 1.0) uploads
 * on top of `upload`. Both engines check the token (admin, or user with
 * auth-client) and the size / kind limits when an upload is created, and on
 * finish hand the file to MediaFilesService (magic bytes, storage, media_files
 * row). `GET files/tus/:uploadId/result` returns the media file; the worker
 * deletes unfinished uploads after TUS_EXPIRE_HOURS.
 * - tusd (default): a tusproject/tusd service in docker-compose posting hooks to
 *   `POST /api/internal/tus-hooks` (shared volume TUS_DIR);
 * - node: @tus/server + @tus/file-store inside the api at `/api/files/tus`.
 * Re-run after `auth-client` to accept user tokens, or with the other engine to add it.
 */
export function uploadTus(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const root = options.root ?? '';
    const project = getProject(tree, root);
    requireFeatures(tree, 'upload-tus', ['upload'], root);

    const previous = previousEngines(tree, root);
    const engine: TusEngine = options.engine ?? previous.engine ?? 'tusd';
    const engines = new Set<TusEngine>([...previous.installed, engine]);
    const node = engines.has('node');
    const tusd = engines.has('tusd');
    const client = hasFeature(tree, CLIENT_AUTH_FEATURE, root);
    const tusModule = prefixed(root, TUS_MODULE_FILE);

    const source = (dir: string): Source =>
      apply(url(dir), [
        filter((path) => !CREATE_ONLY.some((f) => path === `/${f}` && tree.exists(prefixed(root, f)))),
        applyTemplates({}),
        root ? move(root) : noop(),
      ]);

    const wire: Rule = (host: Tree) => {
      addModuleImport(host, project.apiModule, 'TusModule', './modules/tus/tus.module');
      addEnv(
        host,
        {
          title: 'Resumable uploads (tus)',
          vars: [
            {
              key: 'TUS_DIR',
              value: '',
              comment: `Unfinished uploads (default UPLOAD_DIR/.tus); with tusd the folder its volume is mounted at (docker: ${TUSD_DATA_DIR})`,
            },
            { key: 'TUS_EXPIRE_HOURS', value: '24', type: 'number', comment: 'The worker deletes unfinished uploads untouched this long; 0 = never' },
          ],
        },
        root,
      );

      if (node) {
        addModuleController(host, tusModule, {
          expression: 'TusNodeController',
          imports: [{ name: 'TusNodeController', from: './tus-node.controller' }],
        });
        addModuleProvider(host, tusModule, {
          expression: 'TusNodeServer',
          imports: [{ name: 'TusNodeServer', from: './tus-node.server' }],
        });
        addPackageJson(host, { dependencies: TUS_PACKAGES }, root);
      }

      if (tusd) {
        addModuleController(host, tusModule, {
          expression: 'TusHooksController',
          imports: [{ name: 'TusHooksController', from: './tus-hooks.controller' }],
        });
        addModuleProvider(host, tusModule, {
          expression: 'TusHooksService',
          imports: [{ name: 'TusHooksService', from: './tus-hooks.service' }],
        });
        addEnv(
          host,
          {
            title: 'Resumable uploads (tus)',
            vars: [
              {
                key: 'TUS_HOOK_SECRET',
                value: '',
                comment: `tusd hooks (${TUS_HOOKS_PATH}) must send it as X-Tus-Hook-Secret; empty = only from private networks`,
              },
            ],
          },
          root,
        );
        addComposeService(host, 'tusd', TUSD_SERVICE, ['tus-data'], root);
        addComposeServiceEntry(host, 'api', 'environment', `TUS_DIR: ${TUSD_DATA_DIR}`, root);
        addComposeServiceEntry(host, 'api', 'volumes', `- tus-data:${TUSD_DATA_DIR}`, root);
        // tusd first: the shared volume then gets tusd's owner (uid 1000, like the api's node user).
        addComposeServiceEntry(host, 'api', 'depends_on', 'tusd:\n  condition: service_started', root);
      }

      if (client) {
        addModuleProvider(host, tusModule, {
          expression: '{ provide: TUS_USER_AUTH, useClass: TusUserAuth }',
          imports: [
            { name: 'TUS_USER_AUTH', from: './tus-auth.service' },
            { name: 'TusUserAuth', from: './tus-user-auth' },
          ],
        });
      }

      registerTusCleanup(host, context.logger, root);
      recordFeature(host, 'upload-tus', { engine }, engine, root);
      for (const other of engines) recordFeature(host, 'upload-tus', {}, other, root);
      scheduleInstall(context, options.skipInstall, root);
      return host;
    };

    return chain([
      mergeSafe(source('./files/core'), options.force),
      node ? mergeSafe(source('./files/node'), options.force) : noop(),
      tusd ? mergeSafe(source('./files/tusd'), options.force) : noop(),
      client ? mergeSafe(source('./files/client'), options.force) : noop(),
      wire,
      (_host: Tree, ctx: SchematicContext) => {
        const routes = ['GET /api/files/tus/:uploadId/result'];
        if (node) routes.unshift('tus endpoint /api/files/tus (POST, then HEAD/PATCH/DELETE /api/files/tus/:uploadId)');
        if (tusd) routes.push(`tusd hooks POST ${TUS_HOOKS_PATH}`);
        ctx.logger.info(`Resumable uploads (${[...engines].join(', ')}): ${routes.join('; ')}.`);
        if (tusd) {
          ctx.logger.info(
            `tusd: docker compose up -d tusd (${TUSD_IMAGE}, clients upload to http://localhost:8080/files/). ` +
              'Running the api outside Docker: point -hooks-http at http://host.docker.internal:3000' +
              `${TUS_HOOKS_PATH} and mount TUS_DIR as ${TUSD_DATA_DIR}.`,
          );
        }
        if (!client) {
          ctx.logger.info(`User tokens are accepted after "${CLIENT_AUTH_FEATURE}" when you re-run "npm run g -- upload-tus".`);
        }
      },
    ]);
  };
}
