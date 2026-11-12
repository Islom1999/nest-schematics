import { Tree } from '@angular-devkit/schematics';
import { addNamedImports } from './ast';
import { insertAtMarker } from './markers';
import { importPath } from './text';

export const MIGRATIONS_INDEX = 'libs/database/src/migrations/index.ts';
export const SEEDS_INDEX = 'libs/database/src/seeds/index.ts';
export const PERMISSIONS_FILE = 'libs/common/src/permissions.ts';

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

/**
 * Registers a migration class in `migrations/index.ts`. `file` is the path of
 * the migration file without `.ts`, relative to the project root.
 */
export function addMigration(tree: Tree, className: string, file: string, root = ''): boolean {
  const index = prefixed(root, MIGRATIONS_INDEX);
  const added = insertAtMarker(tree, index, '// @ns:migrations', `${className},`, `${className},`);
  addNamedImports(tree, index, [{ name: className, from: importPath(prefixed(root, 'libs/database/src/migrations'), prefixed(root, file)) }]);
  return added;
}

/** Registers a `Seeder` export in `seeds/index.ts`. `file` is relative to the project root, without `.ts`. */
export function addSeed(tree: Tree, exportName: string, file: string, root = ''): boolean {
  const index = prefixed(root, SEEDS_INDEX);
  const added = insertAtMarker(tree, index, '// @ns:seeds', `${exportName},`, `${exportName},`);
  addNamedImports(tree, index, [{ name: exportName, from: importPath(prefixed(root, 'libs/database/src/seeds'), prefixed(root, file)) }]);
  return added;
}

/** Adds `{ resource, actions }` to the admin permission catalog. */
export function addPermissions(tree: Tree, resource: string, actions: string[] = ['read', 'write'], root = ''): boolean {
  const list = actions.map((a) => `'${a}'`).join(', ');
  return insertAtMarker(
    tree,
    prefixed(root, PERMISSIONS_FILE),
    '// @ns:permissions',
    `{ resource: '${resource}', actions: [${list}] },`,
    `resource: '${resource}',`,
  );
}
