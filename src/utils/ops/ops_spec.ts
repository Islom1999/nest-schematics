import { HostTree, Tree } from '@angular-devkit/schematics';
import { SchematicTestRunner } from '@angular-devkit/schematics/testing';
import * as path from 'path';
import {
  addBarrelExport,
  addEnv,
  addGlobalProvider,
  addModuleImport,
  addModuleProvider,
  addNamedImports,
  addPackageJson,
  insertAtMarker,
  MARKERS,
  readManifest,
  recordFeature,
  requireFeatures,
} from './index';

const MODULE = `import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
  ],
  controllers: [],
})
export class ApiModule {}
`;

function read(tree: Tree, p: string): string {
  return tree.read(p)!.toString('utf-8');
}

describe('ops', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = new HostTree();
    tree.create('/api.module.ts', MODULE);
  });

  describe('module arrays', () => {
    it('adds an import after a trailing comma and does not duplicate forRoot() calls', () => {
      expect(
        addModuleImport(tree, '/api.module.ts', 'ThrottlerModule', '@nestjs/throttler', 'ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])'),
      ).toBeTrue();
      expect(addModuleImport(tree, '/api.module.ts', 'ThrottlerModule', '@nestjs/throttler')).toBeFalse();
      expect(addModuleImport(tree, '/api.module.ts', 'ConfigModule', '@nestjs/config')).toBeFalse();
      const text = read(tree, '/api.module.ts');
      expect(text).toContain(
        `    ConfigModule.forRoot({ isGlobal: true }),\n    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),\n  ],`,
      );
      expect(text.match(/ThrottlerModule/g)!.length).toBe(2);
      expect(text).toContain(`import { ThrottlerModule } from '@nestjs/throttler';`);
    });

    it('creates a missing array property and registers global providers once', () => {
      expect(addGlobalProvider(tree, '/api.module.ts', 'APP_GUARD', 'ThrottlerGuard', '@nestjs/throttler')).toBeTrue();
      expect(addGlobalProvider(tree, '/api.module.ts', 'APP_GUARD', 'ThrottlerGuard', '@nestjs/throttler')).toBeFalse();
      expect(addGlobalProvider(tree, '/api.module.ts', 'APP_GUARD', 'OtherGuard', './other.guard')).toBeTrue();
      const text = read(tree, '/api.module.ts');
      expect(text).toContain('providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_GUARD, useClass: OtherGuard }]');
      expect(text).toContain(`import { ThrottlerGuard } from '@nestjs/throttler';`);
      expect(text).toContain(`import { APP_GUARD } from '@nestjs/core';`);
      expect(text.match(/import \{ APP_GUARD \}/g)!.length).toBe(1);
    });

    it('fills an empty array', () => {
      tree.overwrite('/api.module.ts', MODULE.replace('controllers: [],', 'controllers: [],\n  providers: [],'));
      addModuleProvider(tree, '/api.module.ts', { expression: 'FooService', imports: [{ name: 'FooService', from: './foo' }] });
      expect(read(tree, '/api.module.ts')).toContain('providers: [FooService]');
    });
  });

  it('extends an existing import from the same module', () => {
    addNamedImports(tree, '/api.module.ts', [{ name: 'Global', from: '@nestjs/common' }]);
    expect(read(tree, '/api.module.ts')).toContain(`import { Module, Global } from '@nestjs/common';`);
  });

  it('inserts at a marker with its indentation, once', () => {
    tree.create('/main.ts', 'async function bootstrap() {\n  app.init();\n  // @ns:bootstrap\n}\n');
    expect(insertAtMarker(tree, '/main.ts', MARKERS.bootstrap, 'app.enableShutdownHooks();\napp.use(x);')).toBeTrue();
    expect(insertAtMarker(tree, '/main.ts', MARKERS.bootstrap, 'app.enableShutdownHooks();\napp.use(x);')).toBeFalse();
    expect(read(tree, '/main.ts')).toBe(
      'async function bootstrap() {\n  app.init();\n  app.enableShutdownHooks();\n  app.use(x);\n  // @ns:bootstrap\n}\n',
    );
    expect(() => insertAtMarker(tree, '/main.ts', MARKERS.env, 'x')).toThrowError(/Marker "\/\/ @ns:env" not found/);
  });

  it('merges env sections into .env.example, .env and env.validation.ts', () => {
    tree.create('/.env.example', '# ── App ─────\nPORT=3000\n');
    tree.create('/.env', 'PORT=4000\nPAYME_LOGIN=mine\n');
    tree.create(
      '/libs/common/src/config/env.validation.ts',
      `import { IsString } from 'class-validator';\n\nclass EnvironmentVariables {\n  @IsString()\n  DB_HOST: string;\n  // @ns:env\n}\n`,
    );
    const section = {
      title: 'Payme',
      vars: [
        { key: 'PAYME_LOGIN', value: 'Paycom', comment: 'Merchant login' },
        { key: 'PAYME_PASSWORD', secret: true, minLength: 8 },
        { key: 'PAYME_TIMEOUT_MIN', value: '720', type: 'number' as const },
      ],
    };
    expect(addEnv(tree, section)).toEqual(['PAYME_LOGIN', 'PAYME_PASSWORD', 'PAYME_TIMEOUT_MIN']);
    expect(addEnv(tree, section)).toEqual([]);

    const example = read(tree, '/.env.example');
    expect(example).toContain('# Merchant login\nPAYME_LOGIN=Paycom\nPAYME_PASSWORD=change-me-to-a-long-random-string\nPAYME_TIMEOUT_MIN=720\n');
    expect(example.match(/# ── Payme/g)!.length).toBe(1);

    const env = read(tree, '/.env');
    expect(env).toContain('PAYME_LOGIN=mine');
    expect(env).not.toContain('PAYME_LOGIN=Paycom');
    expect(/PAYME_PASSWORD=[0-9a-f]{64}/.test(env)).toBeTrue();

    const validation = read(tree, '/libs/common/src/config/env.validation.ts');
    expect(validation).toContain('  @IsOptional()\n  @IsString()\n  @MinLength(8)\n  PAYME_PASSWORD?: string;');
    expect(validation).toContain('  @Type(() => Number)\n  @IsInt()\n  PAYME_TIMEOUT_MIN?: number;');
    expect(validation).toContain(`import { IsString, IsOptional, MinLength, IsInt } from 'class-validator';`);
    expect(validation).toContain(`import { Type } from 'class-transformer';`);
    expect(validation.match(/PAYME_LOGIN\?:/g)!.length).toBe(1);
  });

  it('adds missing keys to an existing env section', () => {
    tree.create('/.env.example', '# ── Payme ─────────────────────────────────────────\nPAYME_LOGIN=x\n\n# ── Other ───\nA=1\n');
    addEnv(tree, { title: 'Payme', vars: [{ key: 'PAYME_LOGIN' }, { key: 'PAYME_KEY', value: 'k' }] });
    expect(read(tree, '/.env.example')).toContain('PAYME_LOGIN=x\nPAYME_KEY=k\n\n# ── Other');
  });

  it('adds package.json entries without touching existing ones', () => {
    tree.create('/package.json', JSON.stringify({ dependencies: { b: '1', '@nestjs/core': '^11.0.0' }, scripts: { seed: 'mine' } }));
    expect(
      addPackageJson(tree, { dependencies: { a: '^2.0.0', '@nestjs/core': '^12.0.0' }, scripts: { seed: 'x', health: 'y' } }),
    ).toEqual(['a']);
    const pkg = JSON.parse(read(tree, '/package.json'));
    expect(Object.keys(pkg.dependencies)).toEqual(['@nestjs/core', 'a', 'b']);
    expect(pkg.dependencies['@nestjs/core']).toBe('^11.0.0');
    expect(pkg.scripts).toEqual({ seed: 'mine', health: 'y' });
  });

  it('records features in the manifest and checks requirements', () => {
    expect(() => requireFeatures(tree, 'upload-tus', ['upload'])).toThrowError(/npm run g -- upload/);
    recordFeature(tree, 'payment', { mode: 'wallet' }, 'payme');
    recordFeature(tree, 'payment', {}, 'click');
    recordFeature(tree, 'upload');
    expect(() => requireFeatures(tree, 'upload-tus', ['upload'])).not.toThrow();
    const manifest = readManifest(tree)!;
    expect(Object.keys(manifest.features)).toEqual(['payment', 'upload']);
    expect(manifest.features['payment'].items).toEqual(['click', 'payme']);
    expect(manifest.features['payment'].options).toEqual({ mode: 'wallet' });
  });

  it('drops the placeholder `export {};` from a barrel', () => {
    tree.create('/index.ts', 'export {};\n');
    expect(addBarrelExport(tree, '/index.ts', 'a.entity')).toBeTrue();
    expect(addBarrelExport(tree, '/index.ts', 'a.entity')).toBeFalse();
    expect(read(tree, '/index.ts')).toBe(`export * from './a.entity';\n`);
  });
});

describe('mergeSafe', () => {
  const runner = new SchematicTestRunner('ops', path.join(__dirname, 'testing/collection.json'));

  it('keeps edited files unless forced', async () => {
    const tree = new HostTree();
    tree.create('/same.txt', 'same\n');
    tree.create('/edited.txt', 'my edit\n');
    let result = await runner.runSchematic('safe', {}, tree);
    expect(read(result, '/edited.txt')).toBe('my edit\n');
    expect(read(result, '/new.txt')).toBe('new\n');
    result = await runner.runSchematic('safe', { force: true }, result);
    expect(read(result, '/edited.txt')).toBe('template\n');
  });
});

describe('starter tree helper', () => {
  it('puts the project at the root so add-ons find it', async () => {
    const { createStarterTree } = await import('../../testing/starter-tree');
    const { getProject } = await import('./project');
    const tree = await createStarterTree();
    const project = getProject(tree);
    expect(project.apps).toEqual(['api']);
    expect(tree.exists(project.apiModule)).toBeTrue();
  });
});

describe('registries', () => {
  it('registers migrations, seeds and permissions once', async () => {
    const { createStarterTree } = await import('../../testing/starter-tree');
    const { addMigration, addSeed, addPermissions } = await import('./registries');
    const tree = await createStarterTree();
    for (let i = 0; i < 2; i++) {
      addMigration(tree, 'CreateProduct1700000000000', 'libs/database/src/migrations/1700000000000-create-product');
      addSeed(tree, 'productSeeder', 'libs/database/src/seeds/product.seed');
      addPermissions(tree, 'product');
    }
    const migrations = read(tree, '/libs/database/src/migrations/index.ts');
    expect(migrations).toContain(`import { CreateProduct1700000000000 } from './1700000000000-create-product';`);
    expect(migrations).toContain('  CreateProduct1700000000000,\n  // @ns:migrations');
    expect(migrations.match(/CreateProduct1700000000000,/g)!.length).toBe(1);
    const seeds = read(tree, '/libs/database/src/seeds/index.ts');
    expect(seeds).toContain(`import { productSeeder } from './product.seed';`);
    expect(seeds.match(/productSeeder,/g)!.length).toBe(1);
    const permissions = read(tree, '/libs/common/src/permissions.ts');
    expect(permissions.match(/resource: 'product'/g)!.length).toBe(1);
    expect(permissions).toContain(`{ resource: 'product', actions: ['read', 'write'] },`);
  });
});
