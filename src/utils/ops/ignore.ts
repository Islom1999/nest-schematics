import { Tree } from '@angular-devkit/schematics';
import { readText, writeText } from './text';

/**
 * Appends entries to an ignore file (`.gitignore`, `.dockerignore`) under a
 * `# <title>` comment. Entries already present (exact line) are skipped; a
 * missing file is left alone.
 *
 * @returns the entries that were added.
 */
export function addIgnoreEntries(tree: Tree, file: string, title: string, entries: string[], root = ''): string[] {
  const path = `${root ? `${root}/` : ''}${file}`;
  if (!tree.exists(path)) return [];
  const text = readText(tree, path);
  const present = new Set(text.split('\n').map((l) => l.trim()));
  const missing = entries.filter((e) => !present.has(e));
  if (!missing.length) return [];
  const header = `# ${title}`;
  const base = text.replace(/\n*$/, '');
  const block = present.has(header) ? missing : [header, ...missing];
  writeText(tree, path, `${base}${base ? (present.has(header) ? '\n' : '\n\n') : ''}${block.join('\n')}\n`);
  return missing;
}
