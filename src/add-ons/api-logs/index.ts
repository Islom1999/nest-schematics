import { Rule, SchematicContext, Tree, apply, applyTemplates, chain, move, noop, url } from '@angular-devkit/schematics';
import { createHash } from 'crypto';
import {
  addBarrelExport,
  addEnv,
  addGlobalProvider,
  addMigration,
  addModuleImport,
  addNamedImports,
  addPermissions,
  getProject,
  insertAtMarker,
  mergeSafe,
  MARKERS,
  recordFeature,
  scheduleInstall,
} from '../../utils/ops';
import { registerApiLogCleanup } from './cleanup';
import { registerPaymentLogging } from '../payment/log';
import { Schema } from './schema';

const MIGRATIONS_DIR = 'libs/database/src/migrations';
const MIGRATION_RE = /^(\d{13})-server-api-logs\.ts$/;

/** TypeORM's DefaultNamingStrategy names, so `migration:generate` sees no difference. */
function typeormName(prefix: 'PK_' | 'IDX_', table: string, columns: string[]): string {
  const key = `${table}_${[...columns].sort().join('_')}`;
  return prefix + createHash('sha1').update(key).digest('hex').slice(0, prefix === 'PK_' ? 27 : 26);
}

/** Reuses the timestamp of an existing migration so re-runs change nothing. */
function migrationTimestamp(tree: Tree, root: string): string {
  const dir = tree.getDir(root ? `${root}/${MIGRATIONS_DIR}` : MIGRATIONS_DIR);
  for (const file of dir.subfiles) {
    const match = MIGRATION_RE.exec(file);
    if (match) return match[1];
  }
  return String(Date.now());
}

/**
 * `npm run g -- api-logs`: `server_api_logs` entity + migration, a global
 * interceptor (masked bodies, x-request-id, API_LOG_MODE), `@LogPayment()`,
 * `ApiLogService.logCron()`, read-only admin routes and, with the worker, a
 * daily retention job.
 */
export function apiLogs(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const root = options.root ?? '';
    const project = getProject(tree, root);
    const timestamp = migrationTimestamp(tree, root);

    const files = apply(url('./files'), [
      applyTemplates({
        timestamp,
        primaryKey: typeormName('PK_', 'server_api_logs', ['id']),
        deletedAtIndex: typeormName('IDX_', 'server_api_logs', ['deleted_at']),
      }),
      root ? move(root) : noop(),
    ]);

    const wire: Rule = (host: Tree) => {
      addBarrelExport(host, `${project.entitiesDir}/index.ts`, 'server-api-log.entity');
      addBarrelExport(host, `${project.commonSrc}/index.ts`, 'logging');
      addMigration(host, `ServerApiLogs${timestamp}`, `${MIGRATIONS_DIR}/${timestamp}-server-api-logs`, root);
      addPermissions(host, 'server_api_log', ['read'], root);

      addModuleImport(host, project.apiModule, 'ApiLogModule', '@app/common');
      addGlobalProvider(host, project.apiModule, 'APP_INTERCEPTOR', 'ApiLogInterceptor', '@app/common');
      addModuleImport(host, project.apiModule, 'ServerApiLogsModule', './modules/server-api-logs/server-api-logs.module');

      insertAtMarker(host, project.apiMain, MARKERS.bootstrap, `// x-request-id on every response (api-logs)\napp.use(requestIdMiddleware);`, 'app.use(requestIdMiddleware);');
      addNamedImports(host, project.apiMain, [{ name: 'requestIdMiddleware', from: '@app/common' }]);

      addEnv(
        host,
        {
          title: 'API logs (server_api_logs)',
          vars: [
            {
              key: 'API_LOG_MODE',
              value: options.mode ?? 'errors',
              type: 'enum',
              values: ['errors', 'slow', 'all'],
              comment: 'errors = failed requests only, slow = + requests over API_LOG_SLOW_MS, all = every request',
            },
            { key: 'API_LOG_SLOW_MS', value: '1000', type: 'number' },
            { key: 'API_LOG_MAX_BODY', value: '8192', type: 'number', comment: 'Max stored body size (bytes of JSON); larger bodies keep a preview' },
            {
              key: 'API_LOG_MASK_KEYS',
              value: '',
              comment: 'Extra comma-separated keys to mask (password, token, otp, code, card, cvv, secret, authorization... are always masked)',
            },
            { key: 'API_LOG_SKIP_PATHS', value: '', comment: 'Extra comma-separated path prefixes not to log (/api/health and /docs are skipped)' },
            {
              key: 'API_LOG_RETENTION_DAYS',
              value: String(options.retentionDays ?? 30),
              type: 'number',
              comment: 'The worker deletes older rows daily; 0 = keep forever',
            },
            { key: 'API_LOG_SERVER_ID', value: '', comment: 'Instance name stored with each row (default: host name)' },
          ],
        },
        root,
      );

      registerApiLogCleanup(host, context.logger, root);
      // Payment webhooks installed earlier get @LogPayment() (payment does it itself when it comes later).
      registerPaymentLogging(host, root);
      recordFeature(host, 'api-logs', {}, undefined, root);
      scheduleInstall(context, options.skipInstall, root);
      return host;
    };

    return chain([
      mergeSafe(files, options.force),
      wire,
      (_host: Tree, ctx: SchematicContext) => {
        ctx.logger.info(
          `API logs: run "npm run migration:run" (${MIGRATIONS_DIR}/${timestamp}-server-api-logs.ts), ` +
            'admin routes at /api/admin/server-api-logs (permission server_api_log.read).',
        );
      },
    ]);
  };
}
