import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';

const API_MODULE = '/apps/api/src/api.module.ts';

function migrationFile(tree: UnitTestTree): string {
  const files = tree.files.filter((f) => /^\/libs\/database\/src\/migrations\/\d{13}-app-settings\.ts$/.test(f));
  expect(files.length).toBe(1);
  return files[0];
}

describe('settings add-on', () => {
  const runner = createRunner();
  let tree: UnitTestTree;

  beforeAll(async () => {
    tree = await runner.runSchematic('settings', { skipInstall: true }, await createStarterTree(runner));
  });

  it('adds the entity with a unique key among live rows', () => {
    const entity = tree.readContent('/libs/database/src/entities/app-setting.entity.ts');
    expect(entity).toContain("@Entity({ name: 'app_settings' })");
    expect(entity).toContain("@Index('UQ_app_settings_key', { unique: true, where: '\"deleted_at\" IS NULL' })");
    expect(entity).toContain("@Column({ type: 'jsonb', nullable: true })\n  value: unknown;");
    expect(entity).toContain("@Column({ type: 'boolean', default: false })\n  isPublic: boolean;");
    expect(tree.readContent('/libs/database/src/entities/index.ts')).toContain("export * from './app-setting.entity';");
  });

  it('adds a registered migration with the default maintenance row', () => {
    const file = migrationFile(tree);
    const ts = /(\d{13})/.exec(file)![1];
    const migration = tree.readContent(file);
    expect(migration).toContain(`export class AppSettings${ts} implements MigrationInterface`);
    expect(migration).toMatch(/CONSTRAINT "PK_[0-9a-f]{27}" PRIMARY KEY \("id"\)/);
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS "IDX_[0-9a-f]{26}" ON "app_settings" \("deleted_at"\)/);
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "UQ_app_settings_key" ON "app_settings" ("key") WHERE "deleted_at" IS NULL');
    expect(migration).toContain(`SELECT 'maintenance', '{"enabled": false, "message": ""}'::jsonb`);
    expect(migration).not.toContain('<%');
    const index = tree.readContent('/libs/database/src/migrations/index.ts');
    expect(index).toContain(`import { AppSettings${ts} } from './${ts}-app-settings';`);
  });

  it('adds SettingsService (cached through CACHE_STORE) and the maintenance guard', () => {
    for (const f of ['settings.service', 'settings.module', 'settings.types', 'maintenance.guard', 'index']) {
      expect(tree.exists(`/libs/common/src/settings/${f}.ts`)).withContext(f).toBeTrue();
    }
    expect(tree.readContent('/libs/common/src/index.ts')).toContain("export * from './settings';");
    const service = tree.readContent('/libs/common/src/settings/settings.service.ts');
    expect(service).toContain('@Inject(CACHE_STORE) private readonly cache: CacheStore');
    expect(service).toContain('SETTINGS_CACHE_MS = 10_000');
    const guard = tree.readContent('/libs/common/src/settings/maintenance.guard.ts');
    expect(guard).toContain("['admin', 'auth', 'navigation', 'search', 'health', 'settings/public', 'internal']");
    expect(guard).toContain("code: 'MAINTENANCE'");
  });

  it('registers the modules, the guard after ThrottlerGuard, routes and permissions', () => {
    const api = tree.readContent(API_MODULE);
    expect(api).toContain('{ provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_GUARD, useClass: MaintenanceGuard }');
    expect(api).toMatch(/import \{[^}]*\bSettingsModule\b[^}]*\} from '@app\/common';/);
    expect(api).toMatch(/import \{[^}]*\bMaintenanceGuard\b[^}]*\} from '@app\/common';/);
    expect(api).toContain("import { SettingsAdminModule } from './modules/settings/settings-admin.module';");
    expect(tree.readContent('/libs/common/src/permissions.ts')).toContain("{ resource: 'setting', actions: ['read', 'write'] },");
    const admin = tree.readContent('/apps/api/src/modules/settings/settings-admin.controller.ts');
    expect(admin).toContain("@AdminResource('settings', {");
    expect(admin).toContain("@Put('key/:key')");
    const pub = tree.readContent('/apps/api/src/modules/settings/public-settings.controller.ts');
    expect(pub).toContain("@Controller('settings')");
    expect(pub).toContain("@Get('public')");
    expect(JSON.parse(tree.readContent('/nest-schematics.json')).features.settings).toBeDefined();
  });

  it('is idempotent and keeps the migration timestamp', async () => {
    const before = snapshot(tree);
    const again = await runner.runSchematic('settings', { skipInstall: true }, tree);
    expect(snapshot(again)).toEqual(before);
    expect(migrationFile(again)).toBe(migrationFile(tree));
  });
});
