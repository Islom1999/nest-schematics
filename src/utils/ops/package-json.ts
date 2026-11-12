import { SchematicContext, Tree } from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';
import { readText, writeText } from './text';

export interface PackageChanges {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

function sortKeys(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Adds dependencies and scripts to `<root>/package.json`. Existing versions and
 * scripts are never changed (the user may have pinned or edited them).
 *
 * @returns the names of the added packages (empty when nothing changed).
 */
export function addPackageJson(tree: Tree, changes: PackageChanges, root = ''): string[] {
  const path = `${root ? `${root}/` : ''}package.json`;
  const pkg = JSON.parse(readText(tree, path));
  const added: string[] = [];

  for (const section of ['dependencies', 'devDependencies'] as const) {
    const wanted = changes[section];
    if (!wanted) continue;
    const current: Record<string, string> = pkg[section] ?? {};
    for (const [name, version] of Object.entries(wanted)) {
      if (current[name] || pkg.dependencies?.[name] || pkg.devDependencies?.[name]) continue;
      current[name] = version;
      added.push(name);
    }
    pkg[section] = sortKeys(current);
  }

  let scriptsChanged = false;
  if (changes.scripts) {
    pkg.scripts = pkg.scripts ?? {};
    for (const [name, command] of Object.entries(changes.scripts)) {
      if (pkg.scripts[name]) continue;
      pkg.scripts[name] = command;
      scriptsChanged = true;
    }
  }

  if (added.length || scriptsChanged) writeText(tree, path, `${JSON.stringify(pkg, null, 2)}\n`);
  return added;
}

const scheduled = new WeakSet<object>();

/** Schedules one `npm install` per schematic run, unless `skipInstall`. */
export function scheduleInstall(context: SchematicContext, skipInstall: boolean | undefined, root = ''): void {
  if (skipInstall || scheduled.has(context.engine)) return;
  scheduled.add(context.engine);
  context.addTask(new NodePackageInstallTask(root || undefined));
}
