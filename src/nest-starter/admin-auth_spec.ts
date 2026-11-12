import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree } from '../testing/starter-tree';
import { addMigration, addPermissions, addSeed, insertAtMarker, MARKERS } from '../utils/ops';

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
    expect(service).toContain('new LoginAttemptLimiter(5, 15 * 60_000, cache.shared ? cache : undefined');
    expect(service).toContain('SESSION_CACHE_MS = 30_000');
    // Session cache behind the CACHE_STORE token (memory; Redis with the redis add-on).
    expect(service).toContain('@Inject(CACHE_STORE) private readonly cache: CacheStore');
    expect(read('/apps/api/src/api.module.ts')).toContain('CacheStoreModule');
    expect(read('/libs/common/src/cache/cache.module.ts')).toContain('shared ?? new MemoryCacheStore()');

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
    expect(module).toContain('TypeOrmModule.forFeature([Admin, AdminRole, AdminSession, AdminPasswordReset])');
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

  it('ships forgot/reset password with hashed single-use tokens and the AdminMailer port', () => {
    const controller = read('/apps/api/src/auth/auth.controller.ts');
    expect(controller).toContain("@Post('forgot-password')");
    expect(controller).toContain("@Post('reset-password')");
    expect(controller.match(/@AuthThrottle\(\)/g)?.length).toBe(3);
    expect(controller.match(/@HttpCode\(HttpStatus\.NO_CONTENT\)/g)?.length).toBe(2);
    const dto = read('/apps/api/src/auth/dto/sign-in.dto.ts');
    expect(dto).toContain('export class ForgotPasswordDto');
    expect(dto).toMatch(/class ResetPasswordDto[\s\S]*@MinLength\(PASSWORD_MIN\)/);

    const service = read('/apps/api/src/auth/password-reset.service.ts');
    expect(service).toContain('RESET_TOKEN_TTL_MIN = 30');
    expect(service).toContain('tokenHash: sha256(token)');
    expect(service).toContain('used_at IS NULL AND expires_at > now()');
    expect(service).toContain("revokeAll(adminId, 'password_reset')");
    expect(service).toContain('@Optional() @Inject(ADMIN_MAILER)');
    expect(service).toContain("this.production ? ''");
    expect(read('/apps/api/src/auth/auth.module.ts')).toContain('PasswordResetService');

    const port = read('/libs/common/src/auth/admin-mailer.ts');
    expect(port).toContain("export const ADMIN_MAILER = 'ADMIN_MAILER'");
    expect(port).toContain('sendPasswordReset(mail: PasswordResetMail): Promise<void>');
    expect(read('/libs/common/src/auth/index.ts')).toContain("export * from './admin-mailer';");
    expect(read('/libs/common/src/auth/session-manager.ts')).toContain("'password_reset'");
    expect(read('/.env.example')).toContain('ADMIN_APP_URL=http://localhost:4200');
    expect(read('/libs/common/src/config/env.validation.ts')).toContain('ADMIN_APP_URL?: string;');
  });

  it('ships the portal tables as an explicit second migration', () => {
    const index = read('/libs/database/src/migrations/index.ts');
    expect(index).toContain("import { AdminPortal1700000000001 } from './1700000000001-admin-portal';");
    expect(index.indexOf('AdminAuth1700000000000,')).toBeLessThan(index.indexOf('AdminPortal1700000000001,'));
    expect(index.indexOf('AdminPortal1700000000001,')).toBeLessThan(index.indexOf('// @ns:migrations'));
    const sql = read('/libs/database/src/migrations/1700000000001-admin-portal.ts');
    for (const name of [
      'admin_password_resets',
      'admin_notifications',
      'UQ_admin_password_resets_token_hash',
      'IDX_admin_password_resets_admin_id',
      'FK_admin_password_resets_admin_id',
      'IDX_admin_notifications_admin_created',
      'FK_admin_notifications_admin_id',
    ]) {
      expect(sql).toContain(`"${name}"`);
    }
    const barrel = read('/libs/database/src/entities/index.ts');
    expect(barrel).toContain("export * from './admin-password-reset.entity';");
    expect(barrel).toContain("export * from './admin-notification.entity';");
    expect(read('/libs/database/src/entities/admin-password-reset.entity.ts')).toContain("'UQ_admin_password_resets_token_hash'");
    expect(read('/libs/database/src/entities/admin-notification.entity.ts')).toContain("'IDX_admin_notifications_admin_created'");
  });

  it('ships navigation, search and the admin notifications behind markers and the admin Swagger document', () => {
    const registry = read('/apps/api/src/navigation/navigation.registry.ts');
    expect(registry).toContain('export const NAVIGATION: NavigationItem[]');
    expect(registry).toContain("permission: 'admin.read'");
    expect(registry).toContain("permission: 'role.read'");
    expect(registry).toContain('// @ns:navigation');
    expect(read('/apps/api/src/navigation/navigation.controller.ts')).toContain("@Controller('navigation')");
    expect(read('/apps/api/src/navigation/navigation.controller.ts')).toContain('@UseGuards(AdminGuard)');

    expect(read('/apps/api/src/search/search.module.ts')).toContain('// @ns:search-providers');
    expect(read('/apps/api/src/search/search.module.ts')).toContain('AdminsSearchProvider');
    expect(read('/apps/api/src/search/providers/admins-search.provider.ts')).toContain("permissions = ['admin.read']");
    expect(read('/apps/api/src/search/providers/roles-search.provider.ts')).toContain("permissions = ['role.read']");
    expect(read('/apps/api/src/search/search.controller.ts')).toContain("@Controller('search')");
    expect(read('/apps/api/src/search/search.types.ts')).toContain('SEARCH_RESULT_LIMIT = 5');

    expect(read('/apps/api/src/admin-notifications/admin-notifications.controller.ts')).toContain("@AdminResource('me/notifications')");
    expect(read('/apps/api/src/admin-notifications/admin-notifications.controller.ts')).toContain("@Post(':id/read')");

    const api = read('/apps/api/src/api.module.ts');
    for (const m of ['NavigationModule', 'SearchModule', 'AdminNotificationsModule']) expect(api).toContain(m);
    const swagger = read('/apps/api/src/config/swagger.ts');
    expect(swagger).toMatch(/'navigation',\n\s+'search',\n\s+\/\/ @ns:swagger-admin/);
  });

  it('keeps the navigation and search markers usable by add-ons', () => {
    const copy = tree.branch();
    const nav = '/apps/api/src/navigation/navigation.registry.ts';
    const entry = "{ id: 'billing', title: 'Billing', icon: 'i:b', link: '/billing', permission: 'invoice.read' },";
    expect(insertAtMarker(copy, nav, MARKERS.navigation, entry)).toBeTrue();
    expect(insertAtMarker(copy, nav, MARKERS.navigation, entry)).toBeFalse();
    const text = copy.read(nav)!.toString('utf-8');
    expect(text.indexOf("id: 'roles'")).toBeLessThan(text.indexOf("id: 'billing'"));
    expect(text.indexOf("id: 'billing'")).toBeLessThan(text.lastIndexOf('// @ns:navigation'));
    expect(insertAtMarker(copy, '/apps/api/src/search/search.module.ts', MARKERS.searchProviders, 'InvoicesSearchProvider,')).toBeTrue();
  });

  it('still lets the crud generator import AdminResource from the auth folder', async () => {
    const out = await createRunner().runSchematic('nest-crud', { name: 'product', fields: 'name:string' }, new UnitTestTree(tree.branch()));
    const controller = out.readContent('/apps/api/src/modules/product/product.controller.ts');
    expect(controller).toContain("import { AdminResource } from '../../auth';");
    expect(controller).toContain("@AdminResource('product', {");
    expect(out.readContent('/libs/database/src/entities/index.ts')).toContain("export * from './admin.entity';");
  });
});
