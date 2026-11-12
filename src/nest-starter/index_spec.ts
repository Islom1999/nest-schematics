import { Tree } from '@angular-devkit/schematics';
import { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import * as path from 'path';
import { parseApps } from './index';

const collectionPath = path.join(__dirname, '../collection.json');

describe('nest-starter', () => {
  const runner = new SchematicTestRunner('fuse-nest-schematics', collectionPath);

  describe('default (api, bot, worker)', () => {
    let tree: UnitTestTree;

    beforeAll(async () => {
      tree = await runner.runSchematic('nest-starter', { name: 'ShopApi', skipInstall: true });
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
        'apps/api/src/api.controller.ts',
        'apps/api/src/config/swagger.ts',
        'apps/api/src/auth/index.ts',
        'apps/api/src/auth/admin.guard.ts',
        'apps/api/src/auth/admin-resource.decorator.ts',
        'apps/api/src/auth/auth.module.ts',
        'apps/api/src/auth/auth.service.ts',
        'apps/api/src/auth/auth.controller.ts',
        'apps/bot/tsconfig.app.json',
        'apps/bot/src/main.ts',
        'apps/bot/src/bot.module.ts',
        'apps/bot/src/bot.service.ts',
        'apps/worker/tsconfig.app.json',
        'apps/worker/src/main.ts',
        'apps/worker/src/worker.module.ts',
        'apps/worker/src/worker.service.ts',
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
      ].map((f) => `/shop-api/${f}`);
      for (const file of expected) {
        expect(tree.exists(file)).withContext(file).toBeTrue();
      }
    });

    it('renames gitignore and strips .template suffixes', () => {
      expect(tree.exists('/shop-api/gitignore')).toBeFalse();
      expect(tree.files.filter((f) => f.endsWith('.template'))).toEqual([]);
    });

    it('names package.json after the project with scripts per app', () => {
      const pkg = JSON.parse(tree.readContent('/shop-api/package.json'));
      expect(pkg.name).toBe('shop-api');
      expect(pkg.scripts.build).toBe('nest build api && nest build bot && nest build worker');
      expect(pkg.scripts['start:dev:bot']).toBe('nest start bot --watch');
      expect(pkg.scripts['start:prod:worker']).toBe('node dist/apps/worker/main');
      expect(pkg.dependencies['telegraf']).toBeDefined();
      expect(pkg.dependencies['@nestjs/schedule']).toBeDefined();
    });

    it('declares every app and lib in nest-cli.json', () => {
      const cli = JSON.parse(tree.readContent('/shop-api/nest-cli.json'));
      expect(cli.monorepo).toBeTrue();
      expect(cli.root).toBe('apps/api');
      expect(Object.keys(cli.projects).sort()).toEqual(['api', 'bot', 'common', 'database', 'worker']);
      expect(cli.projects.database.type).toBe('library');
    });

    it('maps @app/common and @app/database in tsconfig', () => {
      const ts = JSON.parse(tree.readContent('/shop-api/tsconfig.json'));
      expect(ts.compilerOptions.paths['@app/common']).toEqual(['libs/common/src']);
      expect(ts.compilerOptions.paths['@app/database']).toEqual(['libs/database/src']);
    });

    it('fills templated values', () => {
      expect(tree.readContent('/shop-api/.env.example')).toContain('DB_DATABASE=shop_api');
      expect(tree.readContent('/shop-api/.env.example')).toContain('BOT_TOKEN=');
      expect(tree.readContent('/shop-api/apps/api/src/config/swagger.ts')).toContain("setTitle('ShopApi API')");
    });

    it('gives nullable base/query properties an explicit Swagger type', () => {
      const entity = tree.readContent('/shop-api/libs/database/src/base.entity.ts');
      expect(entity).toContain("@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })");
      const query = tree.readContent('/shop-api/libs/common/src/dto/table-query.dto.ts');
      expect(query.match(/type: (String|Number),\n\s+nullable: true,/g)?.length).toBe(3);
    });

    it('serves the API under /api (frontend apiUrl)', () => {
      expect(tree.readContent('/shop-api/apps/api/src/main.ts')).toContain("app.setGlobalPrefix('api')");
    });
  });

  describe('--apps', () => {
    it('creates only the api when --apps api', async () => {
      const tree = await runner.runSchematic('nest-starter', { name: 'lean', apps: 'api', skipInstall: true });
      expect(tree.files.some((f) => f.startsWith('/lean/apps/bot'))).toBeFalse();
      expect(tree.files.some((f) => f.startsWith('/lean/apps/worker'))).toBeFalse();
      const pkg = JSON.parse(tree.readContent('/lean/package.json'));
      expect(pkg.scripts.build).toBe('nest build api');
      expect(pkg.dependencies['telegraf']).toBeUndefined();
      expect(pkg.dependencies['@nestjs/schedule']).toBeUndefined();
      expect(Object.keys(JSON.parse(tree.readContent('/lean/nest-cli.json')).projects).sort()).toEqual([
        'api',
        'common',
        'database',
      ]);
      expect(tree.readContent('/lean/.env.example')).not.toContain('BOT_TOKEN');
    });

    it('always includes api', () => {
      expect(parseApps('worker')).toEqual(['api', 'worker']);
      expect(parseApps(' Bot , api ')).toEqual(['api', 'bot']);
      expect(parseApps(undefined)).toEqual(['api', 'bot', 'worker']);
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
