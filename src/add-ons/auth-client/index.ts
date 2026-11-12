import {
  Rule,
  SchematicContext,
  SchematicsException,
  Tree,
  apply,
  chain,
  filter,
  move,
  noop,
  url,
} from '@angular-devkit/schematics';
import { defaultIndexName, primaryKeyName } from '../../nest-crud/naming';
import {
  NamedImport,
  addBarrelExport,
  addEnv,
  addMigration,
  addModuleController,
  addModuleImport,
  addModuleProvider,
  addNamedImports,
  addPackageJson,
  addPermissions,
  getProject,
  hasFeature,
  insertAtMarker,
  mergeSafe,
  readManifest,
  readText,
  recordFeature,
  scheduleInstall,
} from '../../utils/ops';
import { Schema } from './schema';

export const AUTH_CLIENT_METHODS = ['phone', 'email', 'google', 'apple', 'telegram'] as const;
export type AuthClientMethod = (typeof AUTH_CLIENT_METHODS)[number];

/** Groups of `users` columns; a method needs one or more of them. */
export const USER_PARTS = ['phone', 'email', 'password', 'google', 'apple', 'telegram'] as const;
export type UserPart = (typeof USER_PARTS)[number];

const METHOD_PARTS: Record<AuthClientMethod, UserPart[]> = {
  phone: ['phone'],
  email: ['email', 'password'],
  google: ['email', 'google'],
  apple: ['email', 'apple'],
  telegram: ['telegram'],
};

/** Add-ons a method needs, with the command that installs a working provider. */
const METHOD_REQUIRES: Partial<Record<AuthClientMethod, { feature: string; command: string }>> = {
  phone: { feature: 'sms', command: 'npm run g -- sms eskiz   (or: sms log, for development)' },
  email: { feature: 'mail', command: 'npm run g -- mail resend   (or: mail smtp / mail log)' },
};

interface PartSpec {
  /** Column definitions as in CREATE TABLE. */
  columns: { name: string; sql: string }[];
  /** Partial unique index (among rows that are not soft-deleted). */
  unique?: { name: string; column: string };
  /** Entity properties, inserted above `// @ns:user-columns`. */
  entity: string;
  /** Line that identifies the entity code (idempotency key). */
  entityKey: string;
  entityImports?: NamedImport[];
  dtoField?: string;
  dtoMap?: string;
}

const PARTS: Record<UserPart, PartSpec> = {
  phone: {
    columns: [{ name: 'phone', sql: '"phone" character varying(20)' }],
    unique: { name: 'UQ_users_phone', column: 'phone' },
    entityKey: 'phone: string | null;',
    entity: [
      `/** E.164 (+998901234567). Unique among users that are not deleted. */`,
      `@ApiPropertyOptional({ type: String, nullable: true, example: '+998901234567' })`,
      `@Index('UQ_users_phone', { unique: true, where: 'deleted_at IS NULL' })`,
      `@Column({ type: 'varchar', length: 20, nullable: true })`,
      `phone: string | null;`,
    ].join('\n'),
    dtoField: [
      `@ApiPropertyOptional({ type: String, nullable: true, example: '+998901234567' })`,
      `phone: string | null;`,
    ].join('\n'),
    dtoMap: 'phone: user.phone,',
  },
  email: {
    columns: [
      { name: 'email', sql: '"email" character varying(254)' },
      { name: 'email_verified', sql: '"email_verified" boolean NOT NULL DEFAULT false' },
    ],
    unique: { name: 'UQ_users_email', column: 'email' },
    entityKey: 'email: string | null;',
    entity: [
      `/** Stored lowercased; unique among users that are not deleted. */`,
      `@ApiPropertyOptional({ type: String, nullable: true, example: 'user@example.com' })`,
      `@Index('UQ_users_email', { unique: true, where: 'deleted_at IS NULL' })`,
      `@Column({`,
      `  type: 'varchar',`,
      `  length: 254,`,
      `  nullable: true,`,
      `  transformer: {`,
      `    to: (value?: string | null) => (typeof value === 'string' ? normalizeEmail(value) : value),`,
      `    from: (value: string | null) => value,`,
      `  },`,
      `})`,
      `email: string | null;`,
      ``,
      `/** The user proved they own \`email\` (reset code, Google, Apple). */`,
      `@ApiProperty()`,
      `@Column({ type: 'boolean', default: false })`,
      `emailVerified: boolean;`,
    ].join('\n'),
    entityImports: [{ name: 'normalizeEmail', from: './admin.entity' }],
    dtoField: [
      `@ApiPropertyOptional({ type: String, nullable: true, example: 'user@example.com' })`,
      `email: string | null;`,
      ``,
      `@ApiProperty()`,
      `emailVerified: boolean;`,
    ].join('\n'),
    dtoMap: 'email: user.email,\nemailVerified: user.emailVerified,',
  },
  password: {
    columns: [{ name: 'password_hash', sql: '"password_hash" character varying(255)' }],
    entityKey: 'passwordHash: string | null;',
    entity: [
      `/** argon2id; never selected unless asked for. Null = no password (other sign-in methods). */`,
      `@Column({ type: 'varchar', length: 255, nullable: true, select: false })`,
      `passwordHash: string | null;`,
    ].join('\n'),
  },
  google: {
    columns: [{ name: 'google_sub', sql: '"google_sub" character varying(255)' }],
    unique: { name: 'UQ_users_google_sub', column: 'google_sub' },
    entityKey: 'googleSub: string | null;',
    entity: [
      `/** Google account id (\`sub\` of the ID token). */`,
      `@ApiPropertyOptional({ type: String, nullable: true })`,
      `@Index('UQ_users_google_sub', { unique: true, where: 'deleted_at IS NULL' })`,
      `@Column({ type: 'varchar', length: 255, nullable: true })`,
      `googleSub: string | null;`,
    ].join('\n'),
  },
  apple: {
    columns: [{ name: 'apple_sub', sql: '"apple_sub" character varying(255)' }],
    unique: { name: 'UQ_users_apple_sub', column: 'apple_sub' },
    entityKey: 'appleSub: string | null;',
    entity: [
      `/** Apple account id (\`sub\` of the identity token). */`,
      `@ApiPropertyOptional({ type: String, nullable: true })`,
      `@Index('UQ_users_apple_sub', { unique: true, where: 'deleted_at IS NULL' })`,
      `@Column({ type: 'varchar', length: 255, nullable: true })`,
      `appleSub: string | null;`,
    ].join('\n'),
  },
  telegram: {
    columns: [{ name: 'telegram_id', sql: '"telegram_id" bigint' }],
    unique: { name: 'UQ_users_telegram_id', column: 'telegram_id' },
    entityKey: 'telegramId: string | null;',
    entity: [
      `/** Telegram user id (bigint, returned as a string). */`,
      `@ApiPropertyOptional({ type: String, nullable: true, example: '123456789' })`,
      `@Index('UQ_users_telegram_id', { unique: true, where: 'deleted_at IS NULL' })`,
      `@Column({ type: 'bigint', nullable: true })`,
      `telegramId: string | null;`,
    ].join('\n'),
    dtoField: [`@ApiPropertyOptional({ type: String, nullable: true, example: '123456789' })`, `telegramId: string | null;`].join(
      '\n',
    ),
    dtoMap: 'telegramId: user.telegramId,',
  },
};

/** Controllers / providers of each method, relative to client-auth/. */
const METHOD_WIRING: Record<AuthClientMethod, { controllers: [string, string][]; providers: [string, string][] }> = {
  phone: {
    controllers: [['PhoneAuthController', './phone/phone-auth.controller']],
    providers: [['PhoneAuthService', './phone/phone-auth.service']],
  },
  email: {
    controllers: [['EmailAuthController', './email/email-auth.controller']],
    providers: [['EmailAuthService', './email/email-auth.service']],
  },
  google: {
    controllers: [['GoogleAuthController', './google/google-auth.controller']],
    providers: [
      ['SocialAccountsService', './social/social-accounts.service'],
      ['GoogleAuthService', './google/google-auth.service'],
    ],
  },
  apple: {
    controllers: [['AppleAuthController', './apple/apple-auth.controller']],
    providers: [
      ['SocialAccountsService', './social/social-accounts.service'],
      ['AppleAuthService', './apple/apple-auth.service'],
    ],
  },
  telegram: {
    controllers: [['TelegramAuthController', './telegram/telegram-auth.controller']],
    providers: [['TelegramAuthService', './telegram/telegram-auth.service']],
  },
};

const MIGRATIONS_DIR = 'libs/database/src/migrations';
const CLIENT_AUTH_DIR = 'apps/api/src/client-auth';
const USER_ENTITY = 'libs/database/src/entities/user.entity.ts';
/** Files later runs extend at markers: created once, never overwritten. */
const CREATE_ONLY = [USER_ENTITY, `${CLIENT_AUTH_DIR}/dto/client-user.dto.ts`, `${CLIENT_AUTH_DIR}/client-auth.module.ts`];

/** Method directories under client-auth/ and the methods that need them. */
const METHOD_DIRS: Record<string, AuthClientMethod[]> = {
  phone: ['phone'],
  email: ['email'],
  google: ['google'],
  apple: ['apple'],
  telegram: ['telegram'],
  social: ['google', 'apple'],
};

export function parseMethods(value: string | undefined): AuthClientMethod[] {
  const list = (value ?? 'phone')
    .split(',')
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
  const unknown = list.filter((m) => !(AUTH_CLIENT_METHODS as readonly string[]).includes(m));
  if (unknown.length) {
    throw new SchematicsException(
      `auth-client: unknown method(s) ${unknown.map((m) => `"${m}"`).join(', ')}. Use any of: ${AUTH_CLIENT_METHODS.join(', ')}.`,
    );
  }
  if (!list.length) throw new SchematicsException(`auth-client: --methods is empty. Use any of: ${AUTH_CLIENT_METHODS.join(', ')}.`);
  return AUTH_CLIENT_METHODS.filter((m) => list.includes(m));
}

export function partsOf(methods: readonly AuthClientMethod[]): UserPart[] {
  const parts = new Set(methods.flatMap((m) => METHOD_PARTS[m]));
  return USER_PARTS.filter((p) => parts.has(p));
}

/** Parts whose columns are already in user.entity.ts. */
function installedParts(tree: Tree, path: string): UserPart[] {
  if (!tree.exists(path)) return [];
  const text = readText(tree, path);
  return USER_PARTS.filter((p) => text.includes(PARTS[p].entityKey));
}

/** Client-auth migrations already in the project: `{ ts, file }`. */
function clientAuthMigrations(tree: Tree, dir: string): { ts: number; file: string }[] {
  return tree
    .getDir(dir)
    .subfiles.map((f) => /^(\d+)-client-auth(?:-[a-z-]+)?\.ts$/.exec(f))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ ts: Number(m[1]), file: m[0] }));
}

const pascal = (s: string) => s.replace(/(^|-)([a-z])/g, (_m, _d, c: string) => c.toUpperCase());

function uniqueIndexSql(part: PartSpec): string | null {
  if (!part.unique) return null;
  return `CREATE UNIQUE INDEX "${part.unique.name}" ON "users" ("${part.unique.column}") WHERE deleted_at IS NULL`;
}

function q(sql: string): string {
  return `    await queryRunner.query(\`${sql}\`);`;
}

function migrationFile(className: string, doc: string, up: string[], down: string[]): string {
  return [
    `import { MigrationInterface, QueryRunner } from 'typeorm';`,
    ``,
    `/**`,
    ...doc.split('\n').map((l) => ` * ${l}`.trimEnd()),
    ` */`,
    `export class ${className} implements MigrationInterface {`,
    `  name = '${className}';`,
    ``,
    `  public async up(queryRunner: QueryRunner): Promise<void> {`,
    ...up,
    `  }`,
    ``,
    `  public async down(queryRunner: QueryRunner): Promise<void> {`,
    ...down,
    `  }`,
    `}`,
    ``,
  ].join('\n');
}

/** users + user_sessions + user_otps with the columns of `parts`. */
export function baseMigration(className: string, parts: UserPart[]): string {
  const userColumns = [
    '"id" uuid NOT NULL DEFAULT uuid_generate_v4()',
    '"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()',
    '"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()',
    '"deleted_at" TIMESTAMP WITH TIME ZONE',
    '"account_no" BIGSERIAL NOT NULL',
    `"name" character varying(120) NOT NULL DEFAULT ''`,
    '"language" character varying(10)',
    '"is_blocked" boolean NOT NULL DEFAULT false',
    '"last_login_at" TIMESTAMP WITH TIME ZONE',
    ...parts.flatMap((p) => PARTS[p].columns.map((c) => c.sql)),
    `CONSTRAINT "${primaryKeyName('users', ['id'])}" PRIMARY KEY ("id")`,
  ];
  const sessionColumns = [
    '"id" uuid NOT NULL DEFAULT uuid_generate_v4()',
    '"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()',
    '"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()',
    '"deleted_at" TIMESTAMP WITH TIME ZONE',
    '"refresh_hash" character varying(64) NOT NULL',
    '"device_id" character varying(200)',
    '"device_name" character varying(200)',
    '"platform" character varying(50)',
    '"os" character varying(100)',
    '"app_version" character varying(50)',
    `"ip" character varying(64) NOT NULL DEFAULT ''`,
    `"user_agent" character varying(512) NOT NULL DEFAULT ''`,
    '"last_used_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()',
    '"expires_at" TIMESTAMP WITH TIME ZONE NOT NULL',
    '"revoked_at" TIMESTAMP WITH TIME ZONE',
    '"revoke_reason" character varying(50)',
    '"user_id" uuid NOT NULL',
    '"push_token" text',
    '"push_platform" character varying(20)',
    `CONSTRAINT "${primaryKeyName('user_sessions', ['id'])}" PRIMARY KEY ("id")`,
  ];
  const otpColumns = [
    '"id" uuid NOT NULL DEFAULT uuid_generate_v4()',
    '"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()',
    '"purpose" character varying(30) NOT NULL',
    '"target" character varying(254) NOT NULL',
    '"code_hash" character varying(64) NOT NULL',
    '"attempts" integer NOT NULL DEFAULT 0',
    '"expires_at" TIMESTAMP WITH TIME ZONE NOT NULL',
    '"consumed_at" TIMESTAMP WITH TIME ZONE',
    `"ip" character varying(64) NOT NULL DEFAULT ''`,
    `CONSTRAINT "${primaryKeyName('user_otps', ['id'])}" PRIMARY KEY ("id")`,
  ];
  const table = (name: string, columns: string[]) =>
    [`    await queryRunner.query(\`CREATE TABLE "${name}" (`, ...columns.map((c, i) => `      ${c}${i < columns.length - 1 ? ',' : ''}`), `    )\`);`];

  const up = [
    q('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'),
    ...table('users', userColumns),
    `    // Account numbers (payments) start at 100000.`,
    q('ALTER SEQUENCE "users_account_no_seq" START WITH 100000 RESTART WITH 100000'),
    q(`CREATE INDEX "${defaultIndexName('users', ['deleted_at'])}" ON "users" ("deleted_at")`),
    q('CREATE UNIQUE INDEX "UQ_users_account_no" ON "users" ("account_no")'),
    ...parts.map((p) => uniqueIndexSql(PARTS[p])).filter((s): s is string => !!s).map(q),
    ...table('user_sessions', sessionColumns),
    q(`CREATE INDEX "${defaultIndexName('user_sessions', ['deleted_at'])}" ON "user_sessions" ("deleted_at")`),
    q('CREATE INDEX "IDX_user_sessions_user_id" ON "user_sessions" ("user_id")'),
    q('CREATE INDEX "IDX_user_sessions_push_token" ON "user_sessions" ("push_token")'),
    q('CREATE UNIQUE INDEX "UQ_user_sessions_refresh_hash" ON "user_sessions" ("refresh_hash")'),
    q(
      'ALTER TABLE "user_sessions" ADD CONSTRAINT "FK_user_sessions_user_id" FOREIGN KEY ("user_id") ' +
        'REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    ),
    ...table('user_otps', otpColumns),
    q('CREATE INDEX "IDX_user_otps_target" ON "user_otps" ("target", "purpose", "created_at")'),
    q('CREATE INDEX "IDX_user_otps_expires_at" ON "user_otps" ("expires_at")'),
  ];
  const down = [
    q('ALTER TABLE "user_sessions" DROP CONSTRAINT "FK_user_sessions_user_id"'),
    q('DROP TABLE "user_otps"'),
    q('DROP TABLE "user_sessions"'),
    q('DROP TABLE "users"'),
  ];
  const doc =
    `Client auth (npm run g -- auth-client): users, user_sessions, user_otps.\n` +
    `Sign-in columns: ${parts.join(', ') || 'none'}. Re-running the generator with more\n` +
    `methods adds a new migration; never edit this one after it ran.`;
  return migrationFile(className, doc, up, down);
}

/** Adds the columns of `parts` to an existing users table. */
export function partsMigration(className: string, parts: UserPart[]): string {
  const up: string[] = [];
  const down: string[] = [];
  for (const p of parts) {
    const spec = PARTS[p];
    for (const c of spec.columns) up.push(q(`ALTER TABLE "users" ADD ${c.sql}`));
    const index = uniqueIndexSql(spec);
    if (index) up.push(q(index));
  }
  for (const p of [...parts].reverse()) {
    const spec = PARTS[p];
    if (spec.unique) down.push(q(`DROP INDEX "public"."${spec.unique.name}"`));
    for (const c of [...spec.columns].reverse()) down.push(q(`ALTER TABLE "users" DROP COLUMN "${c.name}"`));
  }
  const doc = `Client auth: sign-in columns ${parts.join(', ')} on users (npm run g -- auth-client).`;
  return migrationFile(className, doc, up, down);
}

/**
 * `npm run g -- auth-client --methods phone,email,google,apple,telegram`:
 * client users (`users`), their sessions (`user_sessions`, refresh rotation,
 * push tokens), UserGuard / `@CurrentUser()`, `client/auth/*` routes per
 * method and `admin/users`. Re-run with more methods to add them: the new
 * columns get their own migration.
 */
export function authClient(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const root = options.root ?? '';
    const project = getProject(tree, root);
    const prefix = root ? `${root}/` : '';
    const methods = parseMethods(options.methods);

    const missing = methods
      .map((m) => ({ method: m, req: METHOD_REQUIRES[m] }))
      .filter((x): x is { method: AuthClientMethod; req: { feature: string; command: string } } => !!x.req)
      .filter((x) => !hasFeature(tree, x.req.feature, root));
    if (missing.length) {
      throw new SchematicsException(
        `"auth-client" needs these add-ons first:\n` +
          missing.map((x) => `  ${x.method} sign-in sends codes with "${x.req.feature}": ${x.req.command}`).join('\n'),
      );
    }

    const entityPath = `${prefix}${USER_ENTITY}`;
    const migrationsDir = `${prefix}${MIGRATIONS_DIR}`;
    const before = installedParts(tree, entityPath);
    const existing = clientAuthMigrations(tree, migrationsDir);
    const hasBase = existing.some((m) => m.file.endsWith('-client-auth.ts'));
    const wanted = partsOf(methods);
    const recorded = (readManifest(tree, root)?.features['auth-client']?.options?.['methods'] as string[] | undefined) ?? [];
    const allMethods = AUTH_CLIENT_METHODS.filter((m) => methods.includes(m) || recorded.includes(m));

    const files = apply(url('./files'), [
      filter((path) => {
        const match = /\/client-auth\/([a-z]+)\//.exec(path);
        const owners = match ? METHOD_DIRS[match[1]] : undefined;
        return !owners || owners.some((m) => methods.includes(m));
      }),
      root ? move(root) : noop(),
    ]);

    const wire: Rule = (host: Tree) => {
      const entities = `${project.entitiesDir}/index.ts`;
      addBarrelExport(host, entities, 'user.entity');
      addBarrelExport(host, entities, 'user-session.entity');
      addBarrelExport(host, entities, 'user-otp.entity');

      // Columns, DTO fields and the migration of the requested methods.
      const dtoPath = `${prefix}${CLIENT_AUTH_DIR}/dto/client-user.dto.ts`;
      for (const p of wanted) {
        const spec = PARTS[p];
        insertAtMarker(host, entityPath, '// @ns:user-columns', `\n${spec.entity}`, spec.entityKey);
        if (spec.entityImports) addNamedImports(host, entityPath, spec.entityImports);
        if (spec.dtoField) insertAtMarker(host, dtoPath, '// @ns:client-user-fields', `\n${spec.dtoField}`, spec.dtoField);
        if (spec.dtoMap) insertAtMarker(host, dtoPath, '// @ns:client-user-map', spec.dtoMap);
      }

      const last = Math.max(0, ...existing.map((m) => m.ts));
      const ts = Math.max(Date.now(), last + 1);
      if (!hasBase) {
        const parts = USER_PARTS.filter((p) => wanted.includes(p) || before.includes(p));
        const className = `ClientAuth${ts}`;
        host.create(`${migrationsDir}/${ts}-client-auth.ts`, baseMigration(className, parts));
        addMigration(host, className, `${MIGRATIONS_DIR}/${ts}-client-auth`, root);
      } else {
        const added = wanted.filter((p) => !before.includes(p));
        if (added.length) {
          const slug = added.join('-');
          const className = `ClientAuth${pascal(slug)}${ts}`;
          host.create(`${migrationsDir}/${ts}-client-auth-${slug}.ts`, partsMigration(className, added));
          addMigration(host, className, `${MIGRATIONS_DIR}/${ts}-client-auth-${slug}`, root);
        }
      }

      // Module: sign-in methods, then the api module.
      const modulePath = `${prefix}${CLIENT_AUTH_DIR}/client-auth.module.ts`;
      for (const m of methods) {
        for (const [name, from] of METHOD_WIRING[m].controllers) {
          addModuleController(host, modulePath, { expression: name, imports: [{ name, from }] });
        }
        for (const [name, from] of METHOD_WIRING[m].providers) {
          addModuleProvider(host, modulePath, { expression: name, imports: [{ name, from }] });
        }
      }
      addModuleImport(host, project.apiModule, 'ClientAuthModule', './client-auth/client-auth.module');
      addPermissions(host, 'user', ['read', 'write'], root);

      addEnv(
        host,
        {
          title: 'Client auth (app users)',
          vars: [
            {
              key: 'USER_JWT_SECRET',
              secret: true,
              minLength: 32,
              comment: 'Signs user access tokens. 32+ random chars, different from every other secret',
            },
            { key: 'USER_REFRESH_SECRET', secret: true, minLength: 32, comment: 'Signs user refresh tokens. 32+ random chars' },
            { key: 'USER_JWT_EXPIRES_IN', value: '15m', comment: 'Access token lifetime (15m, 1h...)' },
            { key: 'USER_REFRESH_EXPIRES_IN', value: '30d', comment: 'Session lifetime without use' },
            { key: 'USER_SESSION_LIMIT', value: '5', type: 'number', comment: 'Devices per user; the oldest session ends first' },
          ],
        },
        root,
      );
      if (methods.includes('phone')) {
        addEnv(
          host,
          {
            title: 'Client auth (app users)',
            vars: [{ key: 'USER_OTP_SMS_TEXT', value: '', comment: 'SMS text with {code}. Empty = "Your verification code: {code}"' }],
          },
          root,
        );
      }
      if (methods.includes('google')) {
        addEnv(
          host,
          {
            title: 'Client auth (app users)',
            vars: [{ key: 'GOOGLE_CLIENT_IDS', value: '', comment: 'Google OAuth client IDs (web, Android, iOS), comma separated. Empty = Google sign-in off (503)' }],
          },
          root,
        );
      }
      if (methods.includes('apple')) {
        addEnv(
          host,
          {
            title: 'Client auth (app users)',
            vars: [{ key: 'APPLE_CLIENT_IDS', value: '', comment: 'iOS bundle id and Services ID, comma separated. Empty = Apple sign-in off (503)' }],
          },
          root,
        );
      }
      if (methods.includes('telegram')) {
        addEnv(
          host,
          {
            title: 'Client auth (app users)',
            vars: [
              { key: 'BOT_TOKEN', value: '', comment: 'From @BotFather; the Login Widget must use this bot. Empty = Telegram sign-in off (503)' },
              { key: 'TELEGRAM_AUTH_MAX_AGE', value: '3600', type: 'number', comment: 'Seconds a Telegram sign-in stays valid' },
            ],
          },
          root,
        );
      }
      if (methods.includes('google') || methods.includes('apple')) {
        addPackageJson(host, { dependencies: { jose: '^5.10.0' } }, root);
      }

      recordFeature(host, 'auth-client', { methods: allMethods }, undefined, root);
      scheduleInstall(context, options.skipInstall, root);
      return host;
    };

    return chain([
      mergeSafe(files, options.force, CREATE_ONLY.map((p) => `${prefix}${p}`)),
      wire,
      (_host: Tree, ctx: SchematicContext) => {
        ctx.logger.info(
          `Client auth (${allMethods.join(', ')}): routes under /api/client/auth, admin under /api/admin/users. ` +
            `Protect routes with @UseGuards(UserGuard) and read @CurrentUser() from './client-auth'. ` +
            `Run npm run migration:run.`,
        );
      },
    ]);
  };
}
