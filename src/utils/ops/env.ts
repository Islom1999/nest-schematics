import { Tree } from '@angular-devkit/schematics';
import { randomBytes } from 'crypto';
import { addNamedImports } from './ast';
import { insertAtMarker, MARKERS } from './markers';
import { readText, writeText } from './text';

export type EnvType = 'string' | 'number' | 'boolean' | 'url' | 'enum';

export interface EnvVar {
  key: string;
  /** Value written to `.env.example` (and to `.env` when it exists). */
  value?: string;
  /** One-line comment above the key. */
  comment?: string;
  /** Validation in env.validation.ts. Default `string`. */
  type?: EnvType;
  /** Allowed values for `enum`. */
  values?: string[];
  /** Missing/empty value is allowed. Default true: add-ons must boot with defaults. */
  optional?: boolean;
  /** Secret: `.env.example` gets a placeholder, an existing `.env` gets a random value. */
  secret?: boolean;
  /** Minimum length for strings (e.g. 32 for JWT secrets). */
  minLength?: number;
}

export interface EnvSection {
  /** Section title in .env.example, e.g. `Payme`. */
  title: string;
  vars: EnvVar[];
}

const ENV_VALIDATION = 'libs/common/src/config/env.validation.ts';
const HEADER = (title: string) => `# ── ${title} ${'─'.repeat(Math.max(3, 48 - title.length))}`;

/**
 * Adds a section of variables to `.env.example`, to `.env` when it exists, and
 * validators to env.validation.ts. Keys that are already present anywhere in a
 * file are left alone, so the user's values and edits survive re-runs.
 */
export function addEnv(tree: Tree, section: EnvSection, root = ''): string[] {
  const prefix = root ? `${root}/` : '';
  const added = mergeEnvFile(tree, `${prefix}.env.example`, section, false);
  if (tree.exists(`${prefix}.env`)) mergeEnvFile(tree, `${prefix}.env`, section, true);
  addEnvValidation(tree, `${prefix}${ENV_VALIDATION}`, section.vars);
  return added;
}

function mergeEnvFile(tree: Tree, path: string, section: EnvSection, real: boolean): string[] {
  const text = tree.exists(path) ? readText(tree, path) : '';
  const present = new Set(
    text
      .split('\n')
      .map((l) => /^\s*#?\s*([A-Z0-9_]+)=/.exec(l)?.[1])
      .filter((k): k is string => !!k),
  );
  const missing = section.vars.filter((v) => !present.has(v.key));
  if (!missing.length) return [];

  const block = missing.flatMap((v) => {
    const value = v.secret ? (real ? randomBytes(32).toString('hex') : 'change-me-to-a-long-random-string') : (v.value ?? '');
    return [...(v.comment ? [`# ${v.comment}`] : []), `${v.key}=${value}`];
  });

  const lines = text.replace(/\n+$/, '').split('\n');
  const header = HEADER(section.title);
  const start = lines.findIndex((l) => l.trim() === `# ── ${section.title}` || l.startsWith(`# ── ${section.title} `));
  if (start < 0) {
    const base = text.trim() ? `${lines.join('\n')}\n\n` : '';
    writeText(tree, path, `${base}${header}\n${block.join('\n')}\n`);
  } else {
    let end = lines.findIndex((l, i) => i > start && /^# ── /.test(l));
    if (end < 0) end = lines.length;
    while (end > start + 1 && !lines[end - 1].trim()) end--;
    lines.splice(end, 0, ...block);
    writeText(tree, path, `${lines.join('\n')}\n`);
  }
  return missing.map((v) => v.key);
}

function addEnvValidation(tree: Tree, path: string, vars: EnvVar[]): void {
  if (!tree.exists(path)) return;
  const validators = new Set<string>();
  let needsType = false;

  for (const v of vars) {
    const decorators: string[] = [];
    let tsType = 'string';
    const optional = v.optional !== false;
    if (optional) {
      decorators.push('@IsOptional()');
      validators.add('IsOptional');
    }
    switch (v.type ?? 'string') {
      case 'number':
        needsType = true;
        decorators.push('@Type(() => Number)', '@IsInt()');
        validators.add('IsInt');
        tsType = 'number';
        break;
      case 'boolean':
        decorators.push(`@IsIn(['true', 'false', '1', '0', ''])`);
        validators.add('IsIn');
        break;
      case 'url':
        decorators.push('@IsUrl({ require_tld: false })');
        validators.add('IsUrl');
        break;
      case 'enum':
        decorators.push(`@IsIn([${(v.values ?? []).map((x) => `'${x}'`).join(', ')}])`);
        validators.add('IsIn');
        break;
      default:
        decorators.push('@IsString()');
        validators.add('IsString');
        if (v.minLength) {
          decorators.push(`@MinLength(${v.minLength})`);
          validators.add('MinLength');
        }
    }
    const code = `\n${decorators.join('\n')}\n${v.key}${optional ? '?' : ''}: ${tsType};`;
    insertAtMarker(tree, path, MARKERS.env, code, `${v.key}${optional ? '?' : ''}:`);
  }

  addNamedImports(tree, path, [...validators].map((name) => ({ name, from: 'class-validator' })));
  if (needsType) addNamedImports(tree, path, [{ name: 'Type', from: 'class-transformer' }]);
}
