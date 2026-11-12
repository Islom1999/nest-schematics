import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';
import { OPENAPI_GENERATOR_CLI, OPENAPI_GENERATOR_VERSION } from './index';

const ADMIN = {
  name: 'admin',
  doc: 'admin',
  generator: 'typescript-angular',
  target: '../shop-admin/src/app/core/api',
  skipInstall: true,
};

function json(tree: UnitTestTree, path: string) {
  return JSON.parse(tree.readContent(path));
}

describe('openapi-client', () => {
  const runner = createRunner();
  let starter: UnitTestTree;

  beforeEach(async () => {
    starter = await createStarterTree(runner);
  });

  it('creates openapitools.json with a pinned 7.x generator and the target', async () => {
    const tree = await runner.runSchematic('openapi-client', ADMIN, starter);
    const config = json(tree, '/openapitools.json');
    expect(config['generator-cli'].version).toBe(OPENAPI_GENERATOR_VERSION);
    expect(OPENAPI_GENERATOR_VERSION).toMatch(/^7\.\d+\.\d+$/);
    expect(config['generator-cli'].generators.admin).toEqual({
      generatorName: 'typescript-angular',
      inputSpec: 'openapi/admin.json',
      output: '../shop-admin/src/app/core/api',
      additionalProperties: { ngVersion: '20.0.0', providedIn: 'root', stringEnums: true, withInterfaces: true },
    });
    expect(config['generator-cli'].generators.admin.additionalProperties.npmName).toBeUndefined();
  });

  it('adds the cli devDependency and the generate scripts', async () => {
    const tree = await runner.runSchematic('openapi-client', ADMIN, starter);
    const pkg = json(tree, '/package.json');
    expect(pkg.devDependencies[OPENAPI_GENERATOR_CLI]).toMatch(/^\^2\./);
    expect(pkg.scripts['swagger:export']).toBeDefined();
    expect(pkg.scripts['api:generate:admin']).toBe(
      'npm run swagger:export && openapi-generator-cli generate --generator-key admin',
    );
    expect(pkg.scripts['api:generate']).toBe('npm run swagger:export && openapi-generator-cli generate');
  });

  it('records the target in the manifest', async () => {
    let tree = await runner.runSchematic('openapi-client', ADMIN, starter);
    tree = await runner.runSchematic(
      'openapi-client',
      { name: 'mobile', generator: 'dart-dio', target: '../shop_mobile/packages/api', skipInstall: true },
      tree,
    );
    expect(json(tree, '/nest-schematics.json').features['openapi-client'].items).toEqual(['admin', 'mobile']);
  });

  it('is idempotent for the same name', async () => {
    const once = await runner.runSchematic('openapi-client', ADMIN, starter);
    const twice = await runner.runSchematic('openapi-client', ADMIN, once);
    expect(snapshot(twice)).toEqual(snapshot(once));
  });

  it('adds another target for another name and keeps the first', async () => {
    const once = await runner.runSchematic('openapi-client', ADMIN, starter);
    const tree = await runner.runSchematic(
      'openapi-client',
      { name: 'mobile', generator: 'dart-dio', target: '../shop_mobile/packages/api/', skipInstall: true },
      once,
    );
    const generators = json(tree, '/openapitools.json')['generator-cli'].generators;
    expect(Object.keys(generators)).toEqual(['admin', 'mobile']);
    expect(generators.mobile).toEqual({
      generatorName: 'dart-dio',
      inputSpec: 'openapi/client.json',
      output: '../shop_mobile/packages/api',
      additionalProperties: { pubName: 'app_mobile_api', pubVersion: '1.0.0', pubDescription: 'app client API client' },
    });
    const pkg = json(tree, '/package.json');
    expect(pkg.scripts['api:generate:mobile']).toContain('--generator-key mobile');
    expect(pkg.scripts['api:generate:admin']).toBeDefined();
  });

  it('supports typescript-fetch and a custom pub name for dart-dio', async () => {
    let tree = await runner.runSchematic(
      'openapi-client',
      { name: 'web', generator: 'typescript-fetch', target: '../web/src/api', skipInstall: true },
      starter,
    );
    tree = await runner.runSchematic(
      'openapi-client',
      { name: 'app', generator: 'dart-dio', pubName: 'shop_api', target: '../app/api', skipInstall: true },
      tree,
    );
    const generators = json(tree, '/openapitools.json')['generator-cli'].generators;
    expect(generators.web.additionalProperties).toEqual({ supportsES6: true, stringEnums: true, withInterfaces: true });
    expect(generators.web.inputSpec).toBe('openapi/client.json');
    expect(generators.app.additionalProperties.pubName).toBe('shop_api');
  });

  it('keeps a changed target unless --force', async () => {
    const once = await runner.runSchematic('openapi-client', ADMIN, starter);
    const kept = await runner.runSchematic('openapi-client', { ...ADMIN, target: '../other' }, once);
    expect(json(kept, '/openapitools.json')['generator-cli'].generators.admin.output).toBe(ADMIN.target);
    const forced = await runner.runSchematic('openapi-client', { ...ADMIN, target: '../other', force: true }, once);
    expect(json(forced, '/openapitools.json')['generator-cli'].generators.admin.output).toBe('../other');
  });

  it('extends an existing openapitools.json and keeps its version', async () => {
    starter.create(
      '/openapitools.json',
      JSON.stringify({ spaces: 2, 'generator-cli': { version: '7.10.0', useDocker: true } }),
    );
    const tree = await runner.runSchematic('openapi-client', ADMIN, starter);
    const cli = json(tree, '/openapitools.json')['generator-cli'];
    expect(cli.version).toBe('7.10.0');
    expect(cli.useDocker).toBeTrue();
    expect(cli.generators.admin).toBeDefined();
  });

  it('rejects an unknown document, a bad name and a missing target', async () => {
    await expectAsync(runner.runSchematic('openapi-client', { ...ADMIN, doc: 'mobile' }, starter)).toBeRejectedWithError(
      /Unknown --doc "mobile"/,
    );
    await expectAsync(runner.runSchematic('openapi-client', { ...ADMIN, name: '1x' }, starter)).toBeRejectedWithError(
      /Invalid --name/,
    );
    await expectAsync(
      runner.runSchematic('openapi-client', { name: 'admin', target: '', skipInstall: true }, starter),
    ).toBeRejectedWithError(/--target is required/);
  });

  it('fails outside a project', async () => {
    await expectAsync(runner.runSchematic('openapi-client', ADMIN)).toBeRejectedWithError(/inside a project/);
  });
});
