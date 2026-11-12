import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';
import { parseMethods, partsOf } from './index';

/** Schematics edit the tree they get: run on a copy to compare. */
const copy = (tree: UnitTestTree) => new UnitTestTree(tree.branch());

const CA = '/apps/api/src/client-auth';
const ENTITY = '/libs/database/src/entities/user.entity.ts';
const MODULE = `${CA}/client-auth.module.ts`;
const DTO = `${CA}/dto/client-user.dto.ts`;

function migrations(tree: UnitTestTree): string[] {
  return tree.files.filter((f) => /^\/libs\/database\/src\/migrations\/\d{13}-client-auth(-[a-z-]+)?\.ts$/.test(f)).sort();
}

describe('auth-client add-on', () => {
  const runner = createRunner();

  async function withAddons(...addons: [string, string][]): Promise<UnitTestTree> {
    let tree = await createStarterTree(runner);
    for (const [name, provider] of addons) tree = await runner.runSchematic(name, { provider, skipInstall: true }, tree);
    return tree;
  }

  it('parses methods and maps them to column groups', () => {
    expect(parseMethods(undefined)).toEqual(['phone']);
    expect(parseMethods(' Telegram,phone ')).toEqual(['phone', 'telegram']);
    expect(() => parseMethods('phone,fax')).toThrowError(/unknown method\(s\) "fax"/);
    expect(partsOf(['google', 'email'])).toEqual(['email', 'password', 'google']);
    expect(partsOf(['apple'])).toEqual(['email', 'apple']);
  });

  it('needs the sms add-on for phone and mail for email, with the command to run', async () => {
    const bare = await createStarterTree(runner);
    await expectAsync(runner.runSchematic('auth-client', { skipInstall: true }, bare)).toBeRejectedWithError(/npm run g -- sms eskiz/);
    const withSms = await withAddons(['sms', 'log']);
    await expectAsync(runner.runSchematic('auth-client', { methods: 'phone,email', skipInstall: true }, withSms)).toBeRejectedWithError(
      /npm run g -- mail resend/,
    );
    // Social methods need neither.
    await expectAsync(runner.runSchematic('auth-client', { methods: 'google,telegram', skipInstall: true }, bare)).toBeResolved();
  });

  describe('--methods phone,email', () => {
    let tree: UnitTestTree;
    beforeAll(async () => {
      tree = await runner.runSchematic('auth-client', { methods: 'phone,email', skipInstall: true }, await withAddons(['sms', 'log'], ['mail', 'log']));
    });

    it('adds the contract other add-ons import', () => {
      const index = tree.readContent(`${CA}/index.ts`);
      for (const f of ['client-auth.module', 'current-user.decorator', 'user.guard', 'user-sessions.service', 'client-auth.types']) {
        expect(index).toContain(`export * from './${f}';`);
      }
      const guard = tree.readContent(`${CA}/user.guard.ts`);
      expect(guard).toContain('export class UserGuard');
      expect(guard).toContain("typ: 'user'");
      expect(tree.readContent(`${CA}/current-user.decorator.ts`)).toContain('export const CurrentUser');
      expect(tree.readContent(`${CA}/client-auth.types.ts`)).toMatch(/export interface UserPrincipal \{\s+id: string;\s+sessionId: string;/);
      const sessions = tree.readContent(`${CA}/user-sessions.service.ts`);
      expect(sessions).toContain('async setPushToken(sessionId: string');
      expect(sessions).toContain('async activePushTokens(userIds: string[])');
      const module = tree.readContent(MODULE);
      expect(module).toContain('exports: [CLIENT_AUTH_OPTIONS, UserSessionsService, ClientAuthService, UserGuard, OptionalUserGuard]');
      expect(tree.readContent('/apps/api/src/api.module.ts')).toMatch(/import \{ ClientAuthModule \} from '\.\/client-auth\/client-auth\.module';/);
    });

    it('registers the method controllers and services only', () => {
      const module = tree.readContent(MODULE);
      for (const name of ['PhoneAuthController', 'PhoneAuthService', 'EmailAuthController', 'EmailAuthService']) expect(module).toContain(name);
      for (const name of ['GoogleAuth', 'AppleAuth', 'TelegramAuth', 'SocialAccountsService']) expect(module).not.toContain(name);
      expect(tree.exists(`${CA}/phone/phone-auth.service.ts`)).toBeTrue();
      expect(tree.exists(`${CA}/email/email-auth.service.ts`)).toBeTrue();
      for (const dir of ['google', 'apple', 'telegram', 'social']) expect(tree.getDir(`${CA}/${dir}`).subfiles.length).withContext(dir).toBe(0);
      expect(JSON.parse(tree.readContent('/package.json')).dependencies.jose).toBeUndefined();
    });

    it('adds the method columns with partial unique indexes', () => {
      const entity = tree.readContent(ENTITY);
      expect(entity).toContain("@Index('UQ_users_phone', { unique: true, where: 'deleted_at IS NULL' })");
      expect(entity).toContain("@Index('UQ_users_email', { unique: true, where: 'deleted_at IS NULL' })");
      expect(entity).toContain('passwordHash: string | null;');
      expect(entity).toContain("select: false })\n  passwordHash");
      expect(entity).toContain("import { normalizeEmail } from './admin.entity';");
      expect(entity).not.toContain('googleSub:');
      expect(entity).not.toContain('telegramId:');
      const dto = tree.readContent(DTO);
      expect(dto).toContain('phone: user.phone,');
      expect(dto).toContain('email: user.email,');
      expect(dto).not.toContain('password');
      const barrel = tree.readContent('/libs/database/src/entities/index.ts');
      for (const f of ['user.entity', 'user-session.entity', 'user-otp.entity']) expect(barrel).toContain(`export * from './${f}';`);
    });

    it('writes one registered migration for users, user_sessions and user_otps', () => {
      const files = migrations(tree);
      expect(files.length).toBe(1);
      const ts = /(\d{13})/.exec(files[0])![1];
      const sql = tree.readContent(files[0]);
      expect(sql).toContain(`export class ClientAuth${ts} implements MigrationInterface`);
      expect(sql).toContain('"account_no" BIGSERIAL NOT NULL');
      expect(sql).toContain('ALTER SEQUENCE "users_account_no_seq" START WITH 100000 RESTART WITH 100000');
      expect(sql).toContain('"phone" character varying(20)');
      expect(sql).toContain('"password_hash" character varying(255)');
      expect(sql).toContain('CREATE UNIQUE INDEX "UQ_users_email" ON "users" ("email") WHERE deleted_at IS NULL');
      expect(sql).toContain('"push_token" text');
      expect(sql).toContain('REFERENCES "users"("id") ON DELETE CASCADE');
      expect(sql).toContain('CREATE TABLE "user_otps"');
      expect(sql).not.toContain('google_sub');
      // TypeORM's own names, so migration:generate sees no difference.
      expect(sql).toContain('CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")');
      const index = tree.readContent('/libs/database/src/migrations/index.ts');
      expect(index).toContain(`import { ClientAuth${ts} } from './${ts}-client-auth';`);
      expect(index).toContain(`  ClientAuth${ts},\n  // @ns:migrations`);
    });

    it('adds env keys, permissions and admin routes', () => {
      const env = tree.readContent('/.env.example');
      expect(env).toContain('USER_JWT_SECRET=change-me');
      expect(env).toContain('USER_REFRESH_SECRET=change-me');
      for (const key of ['USER_JWT_EXPIRES_IN=15m', 'USER_REFRESH_EXPIRES_IN=30d', 'USER_SESSION_LIMIT=5', 'USER_OTP_SMS_TEXT=']) expect(env).toContain(key);
      expect(env).not.toContain('GOOGLE_CLIENT_IDS');
      const validation = tree.readContent('/libs/common/src/config/env.validation.ts');
      expect(validation).toContain('USER_JWT_SECRET?:');
      expect(tree.readContent('/libs/common/src/permissions.ts')).toContain("{ resource: 'user', actions: ['read', 'write'] },");
      const admin = tree.readContent(`${CA}/admin/users.controller.ts`);
      expect(admin).toContain("@AdminResource('users', { read: ['user.read'], write: ['user.write'] })");
      expect(admin).toContain("@AdminResource('user', { read: ['user.read'], write: ['user.write'] })");
      expect(admin).toContain('@ApiPaginatedResponse(User)');
      expect(JSON.parse(tree.readContent('/nest-schematics.json')).features['auth-client'].options.methods).toEqual(['phone', 'email']);
    });

    it('adds admin create, edit, delete and an unpaged list, with fields of the installed methods only', () => {
      const admin = tree.readContent(`${CA}/admin/users.controller.ts`);
      expect(admin).toMatch(/@AdminAccess\('read'\)\n {2}@Get\(\)\n/);
      for (const route of ['@Post()', "@Patch(':id')", "@Delete(':id')"]) expect(admin).toContain(`@AdminAccess('write')\n  ${route}`);
      expect(admin.indexOf("@Get('options')")).toBeLessThan(admin.indexOf("@Get(':id')"));
      const create = tree.readContent(`${CA}/admin/dto/create-user.dto.ts`);
      expect(create).toMatch(/phone\?: string \| null;/);
      expect(create).toMatch(/email\?: string \| null;/);
      expect(create).toMatch(/password\?: string;/);
      expect(create).toContain("import { normalizePhone } from '@app/common';");
      expect(create).not.toContain('googleSub');
      expect(tree.readContent(`${CA}/admin/dto/update-user.dto.ts`)).toContain('PartialType(CreateUserDto)');
      expect(tree.readContent(`${CA}/admin/dto/user-list-query.dto.ts`)).toContain('USER_LIST_MAX = 1000');
      const service = tree.readContent(`${CA}/admin/users.service.ts`);
      expect(service).toContain('hashPassword(password)');
      expect(service).toContain("revokeAll(id, 'deleted')");
      expect(tree.exists(`${CA}/admin/users.service.spec.ts`)).toBeTrue();
    });

    it('has no master code and never returns the OTP', () => {
      for (const f of ['phone/phone-auth.service.ts', 'otp.service.ts', 'phone/phone-auth.controller.ts']) {
        const text = tree.readContent(`${CA}/${f}`);
        expect(text).not.toMatch(/master_?code\s*[=:(]|MASTER_CODE|bypass\s*[=:(]|['"]\d{6}['"]/i);
      }
      const sent = tree.readContent(`${CA}/phone/phone-auth.dto.ts`).split('class PhoneCodeSentDto')[1];
      expect(sent).not.toMatch(/^\s+code\??:/m);
    });

    it('changes nothing on a second run', async () => {
      const again = await runner.runSchematic('auth-client', { methods: 'phone,email', skipInstall: true }, copy(tree));
      expect(snapshot(again)).toEqual(snapshot(tree));
    });

    it('adding methods later adds a new migration for the new columns only', async () => {
      const before = migrations(tree);
      const baseSql = tree.readContent(before[0]);
      const more = await runner.runSchematic('auth-client', { methods: 'google,apple,telegram', skipInstall: true }, copy(tree));
      const after = migrations(more);
      expect(after.length).toBe(2);
      expect(more.readContent(before[0])).toBe(baseSql);
      const delta = after.find((f) => f !== before[0])!;
      expect(delta).toMatch(/-client-auth-google-apple-telegram\.ts$/);
      const sql = more.readContent(delta);
      expect(sql).toContain('ALTER TABLE "users" ADD "google_sub" character varying(255)');
      expect(sql).toContain('ALTER TABLE "users" ADD "apple_sub" character varying(255)');
      expect(sql).toContain('ALTER TABLE "users" ADD "telegram_id" bigint');
      expect(sql).toContain('CREATE UNIQUE INDEX "UQ_users_telegram_id" ON "users" ("telegram_id") WHERE deleted_at IS NULL');
      expect(sql).not.toContain('"email"');
      expect(sql).not.toContain('"phone"');
      expect(sql).toContain('DROP COLUMN "google_sub"');

      const module = more.readContent(MODULE);
      for (const name of ['PhoneAuthController', 'GoogleAuthController', 'AppleAuthController', 'TelegramAuthController', 'SocialAccountsService']) {
        expect(module).toContain(name);
      }
      expect(module.match(/SocialAccountsService,/g)!.length).toBe(1);
      const entity = more.readContent(ENTITY);
      expect(entity.match(/email: string \| null;/g)!.length).toBe(1);
      expect(entity).toContain('telegramId: string | null;');
      expect(JSON.parse(more.readContent('/package.json')).dependencies.jose).toBe('^5.10.0');
      const env = more.readContent('/.env.example');
      for (const key of ['GOOGLE_CLIENT_IDS=', 'APPLE_CLIENT_IDS=', 'BOT_TOKEN=', 'TELEGRAM_AUTH_MAX_AGE=3600']) expect(env).toContain(key);
      expect(JSON.parse(more.readContent('/nest-schematics.json')).features['auth-client'].options.methods).toEqual([
        'phone',
        'email',
        'google',
        'apple',
        'telegram',
      ]);

      const again = await runner.runSchematic('auth-client', { methods: 'phone,google', skipInstall: true }, copy(more));
      expect(snapshot(again)).toEqual(snapshot(more));
    });
  });

  it('a social-only install puts every column in the first migration', async () => {
    const tree = await runner.runSchematic('auth-client', { methods: 'apple', skipInstall: true }, await createStarterTree(runner));
    const files = migrations(tree);
    expect(files.length).toBe(1);
    const sql = tree.readContent(files[0]);
    expect(sql).toContain('"apple_sub" character varying(255)');
    expect(sql).toContain('"email_verified" boolean NOT NULL DEFAULT false');
    expect(sql).not.toContain('password_hash');
    expect(tree.exists(`${CA}/social/social-accounts.service.ts`)).toBeTrue();
    expect(tree.exists(`${CA}/google/google-auth.service.ts`)).toBeFalse();
    expect(tree.readContent(MODULE)).toContain('AppleAuthService');
  });
});
