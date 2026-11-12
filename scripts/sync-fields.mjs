#!/usr/bin/env node
// Copies the shared `--fields` parser and its contract fixture to another
// package (fuse-schematics keeps an identical copy):
//
//   node scripts/sync-fields.mjs ../fuse-schematics/src/utils
//
// Both packages test the same examples (fields-contract.json), so a change
// here is made once, synced, and checked by both test suites.
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = ['fields.ts', 'fields-contract.json'];
const source = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'utils');
const target = process.argv[2];

if (!target || target === '-h' || target === '--help') {
  console.error('Usage: node scripts/sync-fields.mjs <target-dir>   (e.g. ../fuse-schematics/src/utils)');
  process.exit(target ? 0 : 1);
}
const dir = resolve(target);
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`Not a directory: ${dir}`);
  process.exit(1);
}
if (dir === resolve(source)) {
  console.error('Target is the source directory.');
  process.exit(1);
}

for (const file of FILES) {
  const from = join(source, file);
  const to = join(dir, file);
  const same = existsSync(to) && readFileSync(to).equals(readFileSync(from));
  if (!same) copyFileSync(from, to);
  console.log(`${same ? 'unchanged' : 'copied   '} ${to}`);
}
