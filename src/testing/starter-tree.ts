import { HostTree, Tree } from '@angular-devkit/schematics';
import { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import * as path from 'path';

export const COLLECTION_PATH = path.join(__dirname, '../collection.json');

export function createRunner(): SchematicTestRunner {
  return new SchematicTestRunner('nest-schematics', COLLECTION_PATH);
}

/**
 * A freshly generated starter project at the tree root, as an add-on sees it
 * when run with `npm run g -- ...` inside the project.
 */
export async function createStarterTree(
  runner: SchematicTestRunner = createRunner(),
  options: Record<string, unknown> = {},
): Promise<UnitTestTree> {
  const generated = await runner.runSchematic('nest-starter', { name: 'app', skipInstall: true, ...options });
  const root = new HostTree();
  generated.getDir('/app').visit((file) => {
    root.create(file.replace(/^\/app\//, '/'), generated.read(file)!);
  });
  return new UnitTestTree(root);
}

/** Every file path and content, to assert that a second run changed nothing. */
export function snapshot(tree: Tree): Map<string, string> {
  const files = new Map<string, string>();
  tree.visit((file) => {
    files.set(file, tree.read(file)!.toString('utf-8'));
  });
  return files;
}
