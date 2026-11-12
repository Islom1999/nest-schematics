import { SchematicsException, Tree } from '@angular-devkit/schematics';
import { addNamedImports, addToDecoratorArray, NamedImport } from './ast';

type ModuleArray = 'imports' | 'providers' | 'controllers' | 'exports';

export interface ModuleEntry {
  /** Source text of the array element, e.g. `ThrottlerModule.forRoot({ ... })`. */
  expression: string;
  /** Imports the expression needs. */
  imports?: NamedImport[];
}

function addToModule(tree: Tree, modulePath: string, array: ModuleArray, entry: ModuleEntry): boolean {
  if (!tree.exists(modulePath)) throw new SchematicsException(`File not found: ${modulePath}`);
  const added = addToDecoratorArray(tree, modulePath, 'Module', array, entry.expression);
  const imported = addNamedImports(tree, modulePath, entry.imports ?? []);
  return added || imported;
}

/**
 * Adds a module to `@Module({ imports })`. `XModule`, `XModule.forRoot(...)`
 * and `XModule.forRootAsync(...)` count as the same entry, so re-runs never
 * add a second copy.
 */
export function addModuleImport(
  tree: Tree,
  modulePath: string,
  className: string,
  importPath: string,
  expression: string = className,
): boolean {
  return addToModule(tree, modulePath, 'imports', {
    expression,
    imports: [{ name: className, from: importPath }],
  });
}

export function addModuleProvider(tree: Tree, modulePath: string, entry: ModuleEntry): boolean {
  return addToModule(tree, modulePath, 'providers', entry);
}

export function addModuleController(tree: Tree, modulePath: string, entry: ModuleEntry): boolean {
  return addToModule(tree, modulePath, 'controllers', entry);
}

export function addModuleExport(tree: Tree, modulePath: string, entry: ModuleEntry): boolean {
  return addToModule(tree, modulePath, 'exports', entry);
}

export type GlobalToken = 'APP_GUARD' | 'APP_INTERCEPTOR' | 'APP_FILTER' | 'APP_PIPE';

/**
 * Registers `{ provide: APP_GUARD, useClass: X }` (or another global token).
 * Order matters for guards: they run in registration order.
 */
export function addGlobalProvider(
  tree: Tree,
  modulePath: string,
  token: GlobalToken,
  className: string,
  importPath: string,
): boolean {
  return addModuleProvider(tree, modulePath, {
    expression: `{ provide: ${token}, useClass: ${className} }`,
    imports: [
      { name: token, from: '@nestjs/core' },
      { name: className, from: importPath },
    ],
  });
}
