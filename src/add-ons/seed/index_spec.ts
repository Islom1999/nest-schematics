import { Tree } from '@angular-devkit/schematics';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';

describe('seed', () => {
  const runner = createRunner();

  it('creates the seed file and registers it once', async () => {
    const tree = await createStarterTree(runner);
    const out = await runner.runSchematic('seed', { name: 'DemoProducts', devOnly: true, skipInstall: true }, tree);

    const file = out.readContent('/libs/database/src/seeds/demo-products.seed.ts');
    expect(file).toContain('export const demoProductsSeeder: Seeder = {');
    expect(file).toContain("name: 'demo-products',");
    expect(file).toContain('devOnly: true,');
    expect(file).toContain("import { Seeder } from './seeder';");

    const index = out.readContent('/libs/database/src/seeds/index.ts');
    expect(index).toContain("import { demoProductsSeeder } from './demo-products.seed';");
    expect(index).toContain('  demoProductsSeeder,\n  // @ns:seeds');

    const manifest = JSON.parse(out.readContent('/nest-schematics.json'));
    expect(manifest.features.seed.items).toEqual(['demo-products']);

    const again = await runner.runSchematic('seed', { name: 'demo-products', devOnly: true, skipInstall: true }, out);
    expect(snapshot(again)).toEqual(snapshot(out));
  });

  it('omits devOnly by default and keeps registry order', async () => {
    let tree: Tree = await createStarterTree(runner);
    tree = await runner.runSchematic('seed', { name: 'roles', skipInstall: true }, tree);
    tree = await runner.runSchematic('seed', { name: 'categories', skipInstall: true }, tree);
    expect(tree.readText('/libs/database/src/seeds/roles.seed.ts')).not.toContain('devOnly');
    const index = tree.readText('/libs/database/src/seeds/index.ts');
    expect(index.indexOf('rolesSeeder,')).toBeLessThan(index.indexOf('categoriesSeeder,'));
  });

  it('keeps an edited seed file unless --force', async () => {
    const tree = await createStarterTree(runner);
    const out = await runner.runSchematic('seed', { name: 'roles', skipInstall: true }, tree);
    out.overwrite('/libs/database/src/seeds/roles.seed.ts', '// mine\n');
    const kept = await runner.runSchematic('seed', { name: 'roles', skipInstall: true }, out);
    expect(kept.readContent('/libs/database/src/seeds/roles.seed.ts')).toBe('// mine\n');
    const forced = await runner.runSchematic('seed', { name: 'roles', force: true, skipInstall: true }, kept);
    expect(forced.readContent('/libs/database/src/seeds/roles.seed.ts')).toContain('rolesSeeder');
  });

  it('rejects invalid names and runs only inside a project', async () => {
    const tree = await createStarterTree(runner);
    await expectAsync(runner.runSchematic('seed', { name: '1st', skipInstall: true }, tree)).toBeRejectedWithError(
      /Invalid seed name/,
    );
    await expectAsync(runner.runSchematic('seed', { name: 'roles', skipInstall: true }, Tree.empty())).toBeRejectedWithError(
      /Run this inside a project/,
    );
  });
});
