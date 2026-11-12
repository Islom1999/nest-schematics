import { Tree } from '@angular-devkit/schematics';
import { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import * as path from 'path';
import { addComposeService, addEnv } from '../utils/ops';
import { parseApps } from './index';

const collectionPath = path.join(__dirname, '../collection.json');

describe('nest-starter', () => {
  const runner = new SchematicTestRunner('nest-schematics', collectionPath);

  describe('default (api only)', () => {
    let tree: UnitTestTree;

    beforeAll(async () => {
      tree = await runner.runSchematic('nest-starter', { name: 'ShopApi', skipInstall: true });
    });

    it('writes the add-on manifest, markers and the "g" script', () => {
      const manifest = JSON.parse(tree.readContent('/shop-api/nest-schematics.json'));
      expect(manifest.features).toEqual({});
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(tree.readContent('/shop-api/apps/api/src/main.ts')).toContain('// @ns:bootstrap');
      expect(tree.readContent('/shop-api/apps/api/src/main.ts')).toContain('// @ns:after-listen');
      expect(tree.readContent('/shop-api/libs/common/src/config/env.validation.ts')).toContain('// @ns:env');
      const pkg = JSON.parse(tree.readContent('/shop-api/package.json'));
      expect(pkg.scripts.g).toBe('nest-schematics');
      expect(pkg.devDependencies['nest-schematics']).toBe(`^${manifest.version}`);
    });

    it('creates the monorepo under a dasherized folder', () => {
      const expected = [
        'package.json',
        'tsconfig.json',
        'nest-cli.json',
        '.env.example',
        '.gitignore',
        'README.md',
        'apps/api/tsconfig.app.json',
        'apps/api/src/main.ts',
        'apps/api/src/api.module.ts',
        'apps/api/src/health/health.controller.ts',
        'apps/api/src/health/health.module.ts',
        'apps/api/src/config/swagger.ts',
        'apps/api/src/auth/index.ts',
        'apps/api/src/auth/admin.guard.ts',
        'apps/api/src/auth/admin-resource.decorator.ts',
        'apps/api/src/auth/auth.module.ts',
        'apps/api/src/auth/auth.service.ts',
        'apps/api/src/auth/auth.controller.ts',
        'libs/database/tsconfig.lib.json',
        'libs/database/src/index.ts',
        'libs/database/src/base.entity.ts',
        'libs/database/src/database.module.ts',
        'libs/database/src/database.config.ts',
        'libs/database/src/data-source.ts',
        'libs/database/src/snake-naming.strategy.ts',
        'libs/database/src/entities/index.ts',
        'libs/common/tsconfig.lib.json',
        'libs/common/src/index.ts',
        'libs/common/src/base/base-crud.service.ts',
        'libs/common/src/base/base-crud.controller.ts',
        'libs/common/src/config/env.validation.ts',
        'libs/common/src/dto/table-query.dto.ts',
        'libs/common/src/query/table-query.ts',
        'libs/common/src/validation/validate-dto.ts',
        'libs/common/src/filters/all-exceptions.filter.ts',
        'libs/common/src/decorators/admin-access.decorator.ts',
        'libs/common/src/decorators/public.decorator.ts',
        'libs/common/src/decorators/auth-throttle.decorator.ts',
        'libs/common/src/config/throttler.config.ts',
        'libs/common/src/config/env.validation.spec.ts',
        'libs/database/src/run-migrations.ts',
        'libs/database/src/seed.ts',
        'libs/database/src/seeds/run-seeders.ts',
        'libs/database/src/seeds/run-seeders.spec.ts',
        'tools/migration.js',
        'test/jest-e2e.json',
        'test/health.e2e-spec.ts',
        'eslint.config.mjs',
        '.prettierrc',
        '.prettierignore',
        'Dockerfile',
        '.dockerignore',
        'docker-compose.yml',
      ].map((f) => `/shop-api/${f}`);
      for (const file of expected) {
        expect(tree.exists(file)).withContext(file).toBeTrue();
      }
    });

    it('renames gitignore and strips .template suffixes', () => {
      expect(tree.exists('/shop-api/gitignore')).toBeFalse();
      expect(tree.files.filter((f) => f.endsWith('.template'))).toEqual([]);
    });

    it('names package.json after the project, with api scripts only', () => {
      const pkg = JSON.parse(tree.readContent('/shop-api/package.json'));
      expect(pkg.name).toBe('shop-api');
      expect(pkg.scripts.build).toBe('nest build api');
      expect(pkg.scripts['start:prod:api']).toBe('node dist/apps/api/main');
      expect(pkg.scripts['start:dev:bot']).toBeUndefined();
      expect(pkg.dependencies['telegraf']).toBeUndefined();
      expect(pkg.dependencies['@nestjs/schedule']).toBeUndefined();
    });

    it('declares the api and the libs in nest-cli.json', () => {
      const cli = JSON.parse(tree.readContent('/shop-api/nest-cli.json'));
      expect(cli.monorepo).toBeTrue();
      expect(cli.root).toBe('apps/api');
      expect(Object.keys(cli.projects)).toEqual(['api', 'common', 'database']);
      expect(cli.projects.api.type).toBe('application');
      expect(cli.projects.database.type).toBe('library');
    });

    it('has no bot or worker app', () => {
      expect(tree.files.some((f) => f.startsWith('/shop-api/apps/bot'))).toBeFalse();
      expect(tree.files.some((f) => f.startsWith('/shop-api/apps/worker'))).toBeFalse();
      expect(tree.readContent('/shop-api/.env.example')).not.toContain('BOT_TOKEN');
    });

    it('maps @app/common and @app/database in tsconfig', () => {
      const ts = JSON.parse(tree.readContent('/shop-api/tsconfig.json'));
      expect(ts.compilerOptions.paths['@app/common']).toEqual(['libs/common/src']);
      expect(ts.compilerOptions.paths['@app/database']).toEqual(['libs/database/src']);
    });

    it('fills templated values', () => {
      expect(tree.readContent('/shop-api/.env.example')).toContain('DB_DATABASE=shop_api');
      expect(tree.readContent('/shop-api/apps/api/src/config/swagger.ts')).toContain("setTitle('ShopApi API')");
    });

    it('gives nullable base/query properties an explicit Swagger type', () => {
      const entity = tree.readContent('/shop-api/libs/database/src/base.entity.ts');
      expect(entity).toContain("@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })");
      const query = tree.readContent('/shop-api/libs/common/src/dto/table-query.dto.ts');
      expect(query.match(/type: (String|Number),\n\s+nullable: true,/g)?.length).toBe(3);
    });

    it('uses migrations, not synchronize', () => {
      const env = tree.readContent('/shop-api/.env.example');
      expect(env).toContain('DB_SYNCHRONIZE=false');
      expect(env).toContain('DB_MIGRATIONS_RUN=true');
      for (const file of ['database.config.ts', 'data-source.ts']) {
        const text = tree.readContent(`/shop-api/libs/database/src/${file}`);
        expect(text).withContext(file).toContain("import { migrations } from './migrations';");
      }
      expect(tree.readContent('/shop-api/libs/database/src/migrations/index.ts')).toContain('// @ns:migrations');
      expect(tree.readContent('/shop-api/libs/database/src/seeds/index.ts')).toContain('// @ns:seeds');
      const pkg = JSON.parse(tree.readContent('/shop-api/package.json'));
      expect(pkg.scripts.typeorm).toContain('ts-node');
      expect(pkg.scripts.typeorm).not.toContain('typeorm-ts-node-commonjs');
      for (const script of ['generate', 'create', 'run', 'revert', 'show']) {
        expect(pkg.scripts[`migration:${script}`]).withContext(script).toBeDefined();
      }
      expect(pkg.scripts.seed).toContain('libs/database/src/seed.ts');
    });

    it('declares lint, format, unit and e2e test scripts and their tools', () => {
      const pkg = JSON.parse(tree.readContent('/shop-api/package.json'));
      for (const script of ['lint', 'format', 'test', 'test:e2e']) {
        expect(pkg.scripts[script]).withContext(script).toBeDefined();
      }
      for (const dep of ['eslint', 'typescript-eslint', 'eslint-config-prettier', 'prettier', 'jest', 'ts-jest', 'supertest', '@nestjs/testing']) {
        expect(pkg.devDependencies[dep]).withContext(dep).toBeDefined();
      }
      for (const dep of ['@nestjs/terminus', '@nestjs/throttler', 'compression']) {
        expect(pkg.dependencies[dep]).withContext(dep).toBeDefined();
      }
      expect(pkg.jest.moduleNameMapper['^@app/common(|/.*)$']).toBe('<rootDir>/libs/common/src$1');
    });

    it('wires health, rate limiting and bootstrap hygiene', () => {
      const module = tree.readContent('/shop-api/apps/api/src/api.module.ts');
      expect(module).toContain('HealthModule');
      expect(module).toContain('{ provide: APP_GUARD, useClass: ThrottlerGuard }');
      const health = tree.readContent('/shop-api/apps/api/src/health/health.controller.ts');
      expect(health).toContain('@Public()');
      expect(health).toContain("@Get('live')");
      expect(health).toContain("@Get('ready')");
      const main = tree.readContent('/shop-api/apps/api/src/main.ts');
      expect(main).toContain('app.enableShutdownHooks();');
      expect(main).toContain('compression(');
      expect(tree.readContent('/shop-api/apps/api/src/auth/auth.controller.ts')).toContain('@AuthThrottle()');
      const env = tree.readContent('/shop-api/.env.example');
      for (const key of ['THROTTLE_TTL=60', 'THROTTLE_LIMIT=100', 'AUTH_THROTTLE_LIMIT=5']) {
        expect(env).toContain(key);
      }
    });

    it('validates every env key it documents', () => {
      const validation = tree.readContent('/shop-api/libs/common/src/config/env.validation.ts');
      for (const key of ['DB_SYNCHRONIZE', 'DB_MIGRATIONS_RUN', 'THROTTLE_TTL', 'THROTTLE_LIMIT', 'AUTH_THROTTLE_LIMIT']) {
        expect(validation).withContext(key).toContain(`${key}?:`);
      }
    });

    it('lets add-ons extend docker-compose.yml and the env schema', () => {
      const compose = tree.readContent('/shop-api/docker-compose.yml');
      expect(compose).toContain('POSTGRES_DB: ${DB_DATABASE:-shop_api}');
      expect(compose).toMatch(/\n  # @ns:services\n/);
      expect(compose).toMatch(/\nvolumes:\n  postgres-data:\n  # @ns:volumes\n/);

      for (let i = 0; i < 2; i++) {
        addComposeService(tree, 'redis', 'image: redis:7-alpine\nvolumes:\n  - redis-data:/data', ['redis-data'], 'shop-api');
        addEnv(tree, { title: 'Redis', vars: [{ key: 'REDIS_URL', value: 'redis://localhost:6379' }] }, 'shop-api');
      }
      const updated = tree.readContent('/shop-api/docker-compose.yml');
      expect(updated).toContain('\n  redis:\n    image: redis:7-alpine\n    volumes:\n      - redis-data:/data\n  # @ns:services\n');
      expect(updated).toContain('\n  postgres-data:\n  redis-data:\n  # @ns:volumes\n');
      expect(updated.match(/^  redis:$/gm)?.length).toBe(1);
      const validation = tree.readContent('/shop-api/libs/common/src/config/env.validation.ts');
      expect(validation).toContain('  REDIS_URL?: string;\n  // @ns:env\n');
    });

    it('serves the API under /api (frontend apiUrl)', () => {
      expect(tree.readContent('/shop-api/apps/api/src/main.ts')).toContain("app.setGlobalPrefix('api')");
    });
  });

  describe('--apps api,bot,worker', () => {
    let tree: UnitTestTree;

    beforeAll(async () => {
      tree = await runner.runSchematic('nest-starter', { name: 'full', apps: 'api,bot,worker', skipInstall: true });
    });

    it('runs the bot and worker add-ons inside the new project', () => {
      for (const file of [
        'apps/bot/tsconfig.app.json',
        'apps/bot/src/main.ts',
        'apps/bot/src/bot.module.ts',
        'apps/bot/src/bot.service.ts',
        'apps/worker/tsconfig.app.json',
        'apps/worker/src/main.ts',
        'apps/worker/src/worker.module.ts',
        'apps/worker/src/worker.service.ts',
      ]) {
        expect(tree.exists(`/full/${file}`)).withContext(file).toBeTrue();
      }
      expect(tree.files.some((f) => f.startsWith('/apps/'))).withContext('nothing outside the project').toBeFalse();
      expect(tree.readContent('/full/apps/worker/src/worker.module.ts')).toContain('// @ns:worker-jobs');
    });

    it('records the features and patches package.json, nest-cli.json and .env.example', () => {
      expect(Object.keys(JSON.parse(tree.readContent('/full/nest-schematics.json')).features)).toEqual(['bot', 'worker']);
      const pkg = JSON.parse(tree.readContent('/full/package.json'));
      expect(pkg.scripts.build).toBe('nest build api && nest build bot && nest build worker');
      expect(pkg.scripts['start:dev:bot']).toBe('nest start bot --watch');
      expect(pkg.scripts['start:prod:worker']).toBe('node dist/apps/worker/main');
      expect(pkg.dependencies['telegraf']).toBeDefined();
      expect(pkg.dependencies['@nestjs/schedule']).toBeDefined();
      const cli = JSON.parse(tree.readContent('/full/nest-cli.json'));
      expect(Object.keys(cli.projects)).toEqual(['api', 'bot', 'worker', 'common', 'database']);
      expect(cli.projects.worker.sourceRoot).toBe('apps/worker/src');
      expect(tree.readContent('/full/.env.example')).toContain('BOT_TOKEN=\n');
      expect(tree.readContent('/full/libs/common/src/config/env.validation.ts')).toContain('BOT_TOKEN?: string;');
    });

    it('does not schedule an install per add-on', async () => {
      const r = new SchematicTestRunner('nest-schematics', collectionPath);
      await r.runSchematic('nest-starter', { name: 'one', apps: 'worker,bot' });
      expect(r.tasks.filter((t) => t.name === 'node-package').length).toBe(1);
    });
  });

  describe('parseApps', () => {
    it('defaults to api and always includes it', () => {
      expect(parseApps(undefined)).toEqual(['api']);
      expect(parseApps('worker')).toEqual(['api', 'worker']);
      expect(parseApps(' Bot , api ')).toEqual(['api', 'bot']);
    });

    it('rejects unknown apps', () => {
      expect(() => parseApps('api,cron')).toThrowError(/Unknown app\(s\): cron/);
    });
  });

  it('schedules npm install unless --skipInstall', async () => {
    await runner.runSchematic('nest-starter', { name: 'other' });
    expect(runner.tasks.some((t) => t.name === 'node-package')).toBeTrue();
  });

  it('honours --directory', async () => {
    const t = await runner.runSchematic('nest-starter', { name: 'api', directory: 'apps', skipInstall: true });
    expect(t.exists('/apps/api/apps/api/src/main.ts')).toBeTrue();
  });

  it('refuses an existing directory', async () => {
    const existing = Tree.empty();
    existing.create('/shop-api/keep.txt', 'x');
    await expectAsync(
      runner.runSchematic('nest-starter', { name: 'shop-api', skipInstall: true }, existing),
    ).toBeRejectedWithError(/already exists/);
  });
});
