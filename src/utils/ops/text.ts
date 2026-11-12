import { SchematicsException, Tree } from '@angular-devkit/schematics';
import { normalize } from '@angular-devkit/core';
import { posix } from 'path';

export function readText(tree: Tree, path: string): string {
  const buffer = tree.read(path);
  if (!buffer) throw new SchematicsException(`File not found: ${path}`);
  return buffer.toString('utf-8');
}

export function writeText(tree: Tree, path: string, content: string): void {
  if (tree.exists(path)) {
    if (tree.read(path)!.toString('utf-8') !== content) tree.overwrite(path, content);
  }
  else tree.create(path, content);
}

/** Relative import specifier from directory `from` to path `to` (always starts with `.`). */
export function importPath(from: string, to: string): string {
  const rel = posix.relative(`/${normalize(from)}`, `/${normalize(to)}`);
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** Leading whitespace of the line that contains `pos`. */
export function indentOf(text: string, pos: number): string {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const match = /^[ \t]*/.exec(text.slice(lineStart, pos));
  return match ? match[0] : '';
}

/** Appends `export * from './<file>';` to a barrel once. */
export function addBarrelExport(tree: Tree, barrel: string, file: string): boolean {
  const line = `export * from './${file}';`;
  const current = tree.exists(barrel) ? readText(tree, barrel) : '';
  if (current.split('\n').some((l) => l.trim() === line)) return false;
  // The starter's empty barrel holds `export {};` only so that it is a module.
  const base = current.split('\n').filter((l) => l.trim() !== 'export {};').join('\n').replace(/\n*$/, '');
  writeText(tree, barrel, `${base}${base ? '\n' : ''}${line}\n`);
  return true;
}
