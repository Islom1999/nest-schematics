import { Rule, SchematicContext, Tree, apply, applyTemplates, chain, move, noop, url } from '@angular-devkit/schematics';
import { createHash } from 'crypto';
import {
  addBarrelExport,
  addGlobalProvider,
  addMigration,
  addModuleImport,
  addPermissions,
  getProject,
  hasFeature,
  mergeSafe,
  recordFeature,
} from '../../utils/ops';
import { Schema } from './schema';

const MIGRATIONS_DIR = 'libs/database/src/migrations';
const MIGRATION_RE = /^(\d{13})-app-settings\.ts$/;

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
 * `npm run g -- settings`: `app_settings` (key unique, value jsonb,
 * description, isPublic) + migration, SettingsService.get/set with a short
 * cache (CACHE_STORE: Redis when the redis add-on is configured), admin CRUD
 * at `admin/settings` (setting.read / setting.write), `GET settings/public`
 * and maintenance mode (a global guard answers 503 on client routes while
 * the `maintenance` setting is enabled).
 */
export function settings(options: Schema): Rule {
  return (tree: Tree) => {
    const root = options.root ?? '';
    const project = getProject(tree, root);
    const timestamp = migrationTimestamp(tree, root);

    const files = apply(url('./files'), [
      applyTemplates({
        timestamp,
        primaryKey: typeormName('PK_', 'app_settings', ['id']),
        deletedAtIndex: typeormName('IDX_', 'app_settings', ['deleted_at']),
      }),
      root ? move(root) : noop(),
    ]);

    const wire: Rule = (host: Tree) => {
      addBarrelExport(host, `${project.entitiesDir}/index.ts`, 'app-setting.entity');
      addBarrelExport(host, `${project.commonSrc}/index.ts`, 'settings');
      addMigration(host, `AppSettings${timestamp}`, `${MIGRATIONS_DIR}/${timestamp}-app-settings`, root);
      addPermissions(host, 'setting', ['read', 'write'], root);

      addModuleImport(host, project.apiModule, 'SettingsModule', '@app/common');
      addModuleImport(host, project.apiModule, 'SettingsAdminModule', './modules/settings/settings-admin.module');
      // After ThrottlerGuard: rate limits still apply while in maintenance.
      addGlobalProvider(host, project.apiModule, 'APP_GUARD', 'MaintenanceGuard', '@app/common');

      recordFeature(host, 'settings', {}, undefined, root);
      return host;
    };

    return chain([
      mergeSafe(files, options.force),
      wire,
      (host: Tree, ctx: SchematicContext) => {
        ctx.logger.info(
          `Settings: run "npm run migration:run" (${MIGRATIONS_DIR}/${timestamp}-app-settings.ts). ` +
            'Admin: /api/admin/settings (setting.read / setting.write), public: GET /api/settings/public. ' +
            'Maintenance: PUT /api/admin/settings/key/maintenance {"value":{"enabled":true,"message":"..."}}. ' +
            (hasFeature(host, 'redis', root)
              ? 'Cache: shared through Redis (redis add-on).'
              : 'Cache: in memory per instance (10s); "npm run g -- redis" shares it.'),
        );
      },
    ]);
  };
}
