import { logging, schema } from '@angular-devkit/core';
import { createConsoleLogger } from '@angular-devkit/core/node';
import { UnsuccessfulWorkflowExecution } from '@angular-devkit/schematics';
import { NodeWorkflow } from '@angular-devkit/schematics/tools';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * `nest-schematics <schematic> [args] [--options]`
 *
 *   npx nest-schematics new shop
 *   npm run g -- crud product --fields "name,price:number"
 *   npm run g -- add payment payme          # "add" is optional sugar
 *
 * A thin replacement for `@angular-devkit/schematics-cli`: the Nest CLI rejects
 * unknown flags such as --fields, and the generic schematics CLI needs the
 * collection name typed every time.
 */

const COLLECTION = join(__dirname, '..', 'collection.json');

interface CollectionJson {
  schematics: Record<string, { description: string; aliases?: string[]; schema?: string; hidden?: boolean; private?: boolean }>;
}

interface PropertySchema {
  type?: string | string[];
  alias?: string;
  description?: string;
  default?: unknown;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function camelize(key: string): string {
  return key.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function resolveSchematic(collection: CollectionJson, name: string): [string, CollectionJson['schematics'][string]] | null {
  for (const [key, entry] of Object.entries(collection.schematics)) {
    if (entry.private || entry.hidden) continue;
    if (key === name || entry.aliases?.includes(name)) return [key, entry];
  }
  return null;
}

export interface ParsedArgs {
  positionals: string[];
  options: Record<string, unknown>;
}

/** Minimal argv parser driven by the schematic's schema (types and aliases). */
export function parseArgs(argv: string[], properties: Record<string, PropertySchema>): ParsedArgs {
  const aliases = new Map<string, string>();
  for (const [key, prop] of Object.entries(properties)) if (prop.alias) aliases.set(prop.alias, key);

  const typeOf = (key: string): string => {
    const type = properties[key]?.type;
    return (Array.isArray(type) ? type[0] : type) ?? 'string';
  };
  const coerce = (key: string, raw: string): unknown => {
    switch (typeOf(key)) {
      case 'boolean':
        return !['false', '0', 'no'].includes(raw.toLowerCase());
      case 'number':
      case 'integer': {
        const n = Number(raw);
        return Number.isNaN(n) ? raw : n;
      }
      default:
        return raw;
    }
  };

  const positionals: string[] = [];
  const options: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    const long = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    const short = /^-([a-zA-Z])$/.exec(arg);
    if (!long && !short) {
      positionals.push(arg);
      continue;
    }
    let key = long ? camelize(long[1]) : aliases.get(short![1]) ?? short![1];
    let value: string | undefined = long?.[2];
    if (key.startsWith('no') && /^no[A-Z]/.test(key) && value === undefined && typeOf(key) !== 'boolean') {
      key = key[2].toLowerCase() + key.slice(3);
      options[key] = false;
      continue;
    }
    if (value === undefined) {
      const next = argv[i + 1];
      if (typeOf(key) === 'boolean' && (next === undefined || !/^(true|false)$/i.test(next))) {
        options[key] = true;
        continue;
      }
      if (next === undefined) throw new Error(`Option --${long?.[1] ?? short![1]} needs a value.`);
      value = next;
      i++;
    }
    options[key] = coerce(key, value);
  }
  return { positionals, options };
}

function printHelp(collection: CollectionJson, logger: logging.Logger): void {
  const version = readJson<{ version: string }>(join(__dirname, '..', '..', 'package.json')).version;
  logger.info(`nest-schematics ${version}\n`);
  logger.info('Usage: nest-schematics <schematic> [name] [--options]   (inside a project: npm run g -- ...)\n');
  logger.info('Schematics:');
  for (const [name, entry] of Object.entries(collection.schematics)) {
    if (entry.private || entry.hidden) continue;
    const aliases = entry.aliases?.length ? ` (${entry.aliases.join(', ')})` : '';
    logger.info(`  ${name}${aliases}\n      ${entry.description}`);
  }
  logger.info('\nCommon options: --dry-run, --force, --help');
}

function printSchematicHelp(name: string, properties: Record<string, PropertySchema>, logger: logging.Logger): void {
  logger.info(`nest-schematics ${name} [options]\n`);
  for (const [key, prop] of Object.entries(properties)) {
    if (['sourceRoot', 'language', 'spec', 'flat'].includes(key)) continue;
    const flag = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    const alias = prop.alias ? `, -${prop.alias}` : '';
    const def = prop.default !== undefined ? ` (default: ${JSON.stringify(prop.default)})` : '';
    logger.info(`  --${flag}${alias}\n      ${prop.description ?? ''}${def}`);
  }
}

export async function main(argv: string[]): Promise<number> {
  const logger = createConsoleLogger(argv.includes('--verbose'), process.stdout, process.stderr);
  const collection = readJson<CollectionJson>(COLLECTION);

  let args = argv.filter((a) => a !== '--verbose');
  if (args[0] === 'add') args = args.slice(1);
  const name = args[0];
  if (!name || name === '--help' || name === '-h' || name === 'help') {
    printHelp(collection, logger);
    return name ? 0 : 1;
  }

  const resolved = resolveSchematic(collection, name);
  if (!resolved) {
    logger.error(`Unknown schematic "${name}". Run "nest-schematics --help" for the list.`);
    return 1;
  }
  const [schematicName, entry] = resolved;
  const schemaJson = entry.schema
    ? readJson<{ properties?: Record<string, PropertySchema> }>(join(__dirname, '..', entry.schema))
    : {};
  const properties: Record<string, PropertySchema> = {
    ...schemaJson.properties,
    dryRun: { type: 'boolean' },
    force: { type: 'boolean' },
    help: { type: 'boolean' },
  };

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args.slice(1), properties);
  } catch (e) {
    logger.error((e as Error).message);
    return 1;
  }
  const { dryRun = false, help = false, ...options } = parsed.options;
  if (help) {
    printSchematicHelp(schematicName, properties, logger);
    return 0;
  }

  const workflow = new NodeWorkflow(process.cwd(), {
    force: false,
    dryRun: !!dryRun,
    packageManager: 'npm',
    resolvePaths: [process.cwd(), __dirname],
    schemaValidation: true,
  });
  workflow.registry.addPostTransform(schema.transforms.addUndefinedDefaults);
  workflow.registry.addSmartDefaultProvider('argv', (s: Record<string, unknown>) =>
    'index' in s ? parsed.positionals[Number(s['index'])] : parsed.positionals,
  );
  workflow.registry.useXDeprecatedProvider((msg) => logger.warn(msg));

  let failed = false;
  let changes = 0;
  workflow.reporter.subscribe((event) => {
    const path = event.path.replace(/^\//, '');
    switch (event.kind) {
      case 'error':
        failed = true;
        logger.error(`ERROR! ${path} ${event.description === 'alreadyExist' ? 'already exists' : 'does not exist'}.`);
        break;
      case 'create':
        changes++;
        logger.info(`CREATE ${path} (${event.content.byteLength} bytes)`);
        break;
      case 'update':
        changes++;
        logger.info(`UPDATE ${path} (${event.content.byteLength} bytes)`);
        break;
      case 'delete':
        changes++;
        logger.info(`DELETE ${path}`);
        break;
      case 'rename':
        changes++;
        logger.info(`RENAME ${path} => ${event.to.replace(/^\//, '')}`);
        break;
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      workflow
        .execute({ collection: COLLECTION, schematic: schematicName, options, logger })
        .subscribe({ error: reject, complete: () => resolve() });
    });
  } catch (e) {
    if (e instanceof UnsuccessfulWorkflowExecution) {
      logger.error('The schematic workflow failed. See above.');
    } else {
      logger.error((e as Error).message);
    }
    return 1;
  }
  if (failed) return 1;
  if (!changes) logger.info('Nothing to do: everything is already in place.');
  if (dryRun) logger.warn('\nDry run: no files were written.');
  return 0;
}
