#!/usr/bin/env node
/**
 * `npm run migration:generate -- add-users`   (or `--name=add-users`)
 *   diff entities against the database and write a migration;
 * `npm run migration:create -- backfill`      (or `--name=backfill`)
 *   write an empty migration.
 *
 * Both register the new class in libs/database/src/migrations/index.ts (the
 * explicit list the apps and the CLI run), above the `// @ns:migrations` marker.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIR = 'libs/database/src/migrations';
const INDEX = path.join(ROOT, DIR, 'index.ts');
const DATA_SOURCE = 'libs/database/src/data-source.ts';
const MARKER = '// @ns:migrations';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
if (!['generate', 'create'].includes(command)) fail('Usage: node tools/migration.js generate|create <name>');
const name = process.env.npm_config_name || rest.find((a) => !a.startsWith('-'));
if (!name || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
  fail(`Migration name is required (letters, digits, - and _):\n  npm run migration:${command} -- add-users`);
}

const before = new Set(fs.readdirSync(path.join(ROOT, DIR)));
const args = [
  require.resolve('ts-node/dist/bin.js'),
  '--transpile-only',
  '-r',
  'tsconfig-paths/register',
  require.resolve('typeorm/cli.js'),
  `migration:${command}`,
  `${DIR}/${name}`,
  ...(command === 'generate' ? ['-d', DATA_SOURCE] : []),
];
const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);

let index = fs.readFileSync(INDEX, 'utf8');
for (const file of fs.readdirSync(path.join(ROOT, DIR)).sort()) {
  if (before.has(file) || !file.endsWith('.ts')) continue;
  const source = fs.readFileSync(path.join(ROOT, DIR, file), 'utf8');
  const className = /export class (\w+)/.exec(source)?.[1];
  if (!className || new RegExp(`\\b${className}\\b`).test(index)) continue;
  const lines = index.split('\n');
  const at = lines.findIndex((l) => l.trim() === MARKER);
  if (at < 0) fail(`${MARKER} not found in ${DIR}/index.ts; add ${className} to the list manually.`);
  lines.splice(at, 0, `${/^\s*/.exec(lines[at])[0]}${className},`);
  const lastImport = lines.reduce((last, l, i) => (l.startsWith('import ') ? i : last), -1);
  lines.splice(lastImport + 1, 0, `import { ${className} } from './${file.replace(/\.ts$/, '')}';`);
  index = lines.join('\n');
  console.log(`Registered ${className} in ${DIR}/index.ts`);
}
fs.writeFileSync(INDEX, index);
