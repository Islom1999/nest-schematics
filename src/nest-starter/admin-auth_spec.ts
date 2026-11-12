import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree } from '../testing/starter-tree';
import { addMigration, addPermissions, addSeed } from '../utils/ops';

describe('nest-starter: admin auth', () => {
  let tree: UnitTestTree;
  const read = (path: string) => tree.readContent(path);

  beforeAll(async () => {
    tree = await createStarterTree(createRunner(), { apps: 'api' });
  });

  it('adds the admin entities on BaseEntity and exports them', () => {
    const barrel = read('/libs/database/src/entities/index.ts');
    for (const file of ['auth-session.base', 'admin-role.entity', 'admin.entity', 'admin-session.entity']) {
      expect(barrel).toContain(`export * from './${file}';`);
      expect(tree.exists(`/libs/database/src/entities/${file}.ts`)).withContext(file).toBeTrue();
    }
    const admin = read('/libs/database/src/entities/admin.entity.ts');
    expect(admin).toContain("@Entity('admins')");
    expect(admin).toContain('export class Admin extends BaseEntity');
    expect(admin).toContain("@Index('UQ_admins_email', ['email'], { unique: true, where: 'deleted_at IS NULL' })");
    expect(admin).toContain('select: false');
    expect(admin).toContain('@ManyToOne(() => AdminRole');

    const role = read('/libs/database/src/entities/admin-role.entity.ts');
    expect(role).toContain("@Entity('admin_roles')");
    expect(role).toContain("type: 'text', array: true");

    const session = read('/libs/database/src/entities/admin-session.entity.ts');
    expect(session).toContain("@Entity('admin_sessions')");
    expect(session).toContain('extends AuthSessionBase');
    expect(session).toContain("onDelete: 'CASCADE'");
    expect(session).toContain("@Index('UQ_admin_sessions_refresh_hash', ['refreshHash'], { unique: true })");

    const base = read('/libs/database/src/entities/auth-session.base.ts');
    expect(base).toContain('export abstract class AuthSessionBase extends BaseEntity');
    for (const column of ['refreshHash', 'deviceId', 'deviceName', 'platform', 'os', 'appVersion', 'ip', 'userAgent', 'lastUsedAt', 'expiresAt', 'revokedAt', 'revokeReason']) {
      expect(base).toContain(`  ${column}: `);
    }
  });

  it('ships a hand-written migration registered in the migrations array', () => {
    const index = read('/libs/database/src/migrations/index.ts');
    expect(index).toContain("import { AdminAuth1700000000000 } from './1700000000000-admin-auth';");
    expect(index.indexOf('AdminAuth1700000000000,')).toBeLessThan(index.indexOf('// @ns:migrations'));

    const sql = read('/libs/database/src/migrations/1700000000000-admin-auth.ts');
    expect(sql).toContain("name = 'AdminAuth1700000000000'");
    for (const table of ['admin_roles', 'admins', 'admin_sessions']) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
      expect(sql).toContain(`DROP TABLE "${table}"`);
    }
    // Same names as the entity decorators, so migration:generate finds no diff.
    for (const name of ['UQ_admins_email', 'UQ_admin_roles_name', 'UQ_admin_sessions_refresh_hash', 'IDX_admins_role_id', 'IDX_admin_sessions_admin_id', 'FK_admins_role_id', 'FK_admin_sessions_admin_id']) {
      expect(sql).toContain(`"${name}"`);
    }
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain('"refresh_hash" character varying(64) NOT NULL');
  });

  it('registers the super admin seeder', () => {
    const index = read('/libs/database/src/seeds/index.ts');
    expect(index).toContain("import { superAdminSeeder } from './super-admin.seed';");
    expect(index.indexOf('superAdminSeeder,')).toBeLessThan(index.indexOf('// @ns:seeds'));
    const seed = read('/libs/database/src/seeds/super-admin.seed.ts');
    expect(seed).toContain("name: 'super-admin'");
    expect(seed).toContain('argon2.argon2id');
  });

  it('keeps the registries usable by generators', () => {
    const copy = tree.branch();
    expect(addPermissions(copy, 'admin')).toBeFalse();
    expect(addPermissions(copy, 'role')).toBeFalse();
    expect(addPermissions(copy, 'product')).toBeTrue();
    expect(addMigration(copy, 'Product1800000000000', 'libs/database/src/migrations/1800000000000-product')).toBeTrue();
    expect(addSeed(copy, 'productSeeder', 'libs/database/src/seeds/product.seed')).toBeTrue();
    const migrations = copy.read('/libs/database/src/migrations/index.ts')!.toString('utf-8');
    expect(migrations.indexOf('AdminAuth1700000000000,')).toBeLessThan(migrations.indexOf('Product1800000000000,'));
  });

  it('adds admin and role to the permission catalog', () => {
    const catalog = read('/libs/common/src/permissions.ts');
    expect(catalog).toContain("{ resource: 'admin', actions: ['read', 'write'] },");
    expect(catalog).toContain("{ resource: 'role', actions: ['read', 'write'] },");
  });

  it('exports the reusable session library from @app/common', () => {
    expect(read('/libs/common/src/index.ts')).toContain("export * from './auth';");
    const lib = read('/libs/common/src/auth/index.ts');
    for (const file of ['device-info', 'duration', 'hash', 'login-attempts', 'session-manager', 'ttl-cache']) {
      expect(lib).toContain(`export * from './${file}';`);
    }
    const manager = read('/libs/common/src/auth/session-manager.ts');
    expect(manager).toContain('export class SessionManager<S extends AuthSessionBase>');
    expect(manager).toContain("'refresh_reuse'");
    expect(manager).toContain("algorithms: [ALGORITHM]");
    expect(read('/libs/common/src/auth/device-info.ts')).toContain("'x-device-id'");
  });

  it('replaces the env-only admin with sessions, rotation and a session-checking guard', () => {
    const service = read('/apps/api/src/auth/auth.service.ts');
    expect(service).not.toContain('SKELETON');
    expect(service).not.toContain("'env-admin'");
    expect(service).toContain('new LoginAttemptLimiter(5, 15 * 60_000)');
    expect(service).toContain('SESSION_CACHE_MS = 30_000');

    const guard = read('/apps/api/src/auth/admin.guard.ts');
    expect(guard).toContain('this.auth.authenticate(token)');
    expect(guard).toContain('IS_PUBLIC_KEY');
    expect(guard).toContain('ADMIN_RESOURCE_KEY');
    expect(guard).toContain("throw new ForbiddenException('Not enough permissions')");

    const controller = read('/apps/api/src/auth/auth.controller.ts');
    for (const route of [
      "@Post('sign-in')",
      "@Post('refresh')",
      "@Post('sign-in-with-token')",
      "@Post('sign-out')",
      "@Post('sign-out-all')",
      "@Get('me')",
      "@Get('sessions')",
      "@Delete('sessions/others')",
      "@Delete('sessions/:id')",
      "@Post('change-password')",
    ]) {
      expect(controller).toContain(route);
    }
    expect(controller.indexOf("@Delete('sessions/others')")).toBeLessThan(controller.indexOf("@Delete('sessions/:id')"));

    const module = read('/apps/api/src/auth/auth.module.ts');
    expect(module).toContain('TypeOrmModule.forFeature([Admin, AdminRole, AdminSession])');
    expect(module).toContain('AdminsController, RolesController, PermissionsController');
    expect(module).toContain('AdminBootstrapService');
    expect(read('/apps/api/src/api.module.ts')).toContain('AuthModule');

    expect(read('/apps/api/src/auth/admins/admins.controller.ts')).toContain(
      "@AdminResource('admins', { read: ['admin.read'], write: ['admin.write'] })",
    );
    expect(read('/apps/api/src/auth/roles/roles.controller.ts')).toContain(
      "@AdminResource('roles', { read: ['role.read'], write: ['role.write'] })",
    );
    expect(read('/apps/api/src/auth/roles/permissions.controller.ts')).toContain('PERMISSION_CATALOG');
  });

  it('documents and validates the env keys and adds argon2', () => {
    const env = read('/.env.example');
    for (const key of [
      'ADMIN_JWT_SECRET',
      'ADMIN_JWT_EXPIRES_IN=15m',
      'ADMIN_REFRESH_SECRET',
      'ADMIN_REFRESH_EXPIRES_IN=30d',
      'ADMIN_SESSION_LIMIT=10',
      'ADMIN_EMAIL=',
      'ADMIN_PASSWORD=',
    ]) {
      expect(env).toContain(key);
    }
    const secrets = env.split('\n').filter((l) => /^ADMIN_(JWT|REFRESH)_SECRET=/.test(l)).map((l) => l.split('=')[1]);
    expect(secrets.length).toBe(2);
    expect(secrets[0]).not.toBe(secrets[1]);
    secrets.forEach((s) => expect(s.length).toBeGreaterThanOrEqual(32));

    const validation = read('/libs/common/src/config/env.validation.ts');
    expect(validation).toMatch(/@MinLength\(32\)\n\s+ADMIN_JWT_SECRET\?: string;/);
    expect(validation).toMatch(/@MinLength\(32\)\n\s+ADMIN_REFRESH_SECRET\?: string;/);
    expect(validation).toContain('ADMIN_SESSION_LIMIT?: number;');
    expect(validation).toContain('// @ns:env');

    const pkg = JSON.parse(read('/package.json'));
    expect(pkg.dependencies.argon2).toBeDefined();
    expect(pkg.dependencies['@nestjs/jwt']).toBeDefined();
  });

  it('still lets the crud generator import AdminResource from the auth folder', async () => {
    const out = await createRunner().runSchematic('nest-crud', { name: 'product', fields: 'name:string' }, new UnitTestTree(tree.branch()));
    const controller = out.readContent('/apps/api/src/modules/product/product.controller.ts');
    expect(controller).toContain("import { AdminResource } from '../../auth';");
    expect(controller).toContain("@AdminResource('product', {");
    expect(out.readContent('/libs/database/src/entities/index.ts')).toContain("export * from './admin.entity';");
  });
});
