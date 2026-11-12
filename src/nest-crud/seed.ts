import { strings } from '@angular-devkit/core';
import { createHash } from 'crypto';
import { FieldSpec } from '../utils/fields';
import { FieldModel, ResourceModel, enumName } from './model';
import { decimalLimit, enumKey, varcharLength } from './render';

/**
 * `--seed N`: a development-only Seeder with N plausible, deterministic rows
 * (fixed ids, so re-running the seed inserts nothing new).
 */

export const SEEDS_DIR = 'libs/database/src/seeds';
export const MAX_SEED_ROWS = 1000;

export function seedExportName(name: string): string {
  return `${strings.camelize(name)}Seeder`;
}

/** Stable UUID (v5 layout) for row `i` of `resource`. */
export function seedId(resource: string, i: number): string {
  const h = createHash('sha1').update(`nest-schematics:${resource}:${i}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function humanize(name: string): string {
  const words = strings.decamelize(name).replace(/[-_]+/g, ' ');
  return words[0].toUpperCase() + words.slice(1);
}

function fit(value: string, f: FieldSpec, max: number | undefined): string {
  let v = value;
  if (max !== undefined && v.length > max) {
    const digits = /\d+$/.exec(v)?.[0] ?? '';
    v = `${v.slice(0, Math.max(0, max - digits.length))}${digits}`.slice(-max);
  }
  while (f.min !== undefined && v.length < f.min) v += 'x';
  return v;
}

function stringValue(model: ResourceModel, f: FieldSpec, i: number): string {
  const n = f.name.toLowerCase();
  const entity = humanize(strings.camelize(model.name));
  let v: string;
  if (n.includes('email')) v = `${model.name}${i}@example.com`;
  else if (n.includes('slug')) v = `${model.name}-${i}`;
  else if (n.includes('phone')) v = `+998900000${String(i).padStart(3, '0')}`;
  else if (/url|link|website/.test(n)) v = `https://example.com/${model.name}/${i}`;
  else if (/code|sku/.test(n)) v = `${strings.underscore(model.name).toUpperCase()}-${String(i).padStart(3, '0')}`;
  else if (n === 'name' || n === 'title') v = `${entity} ${i}`;
  else v = `${humanize(f.name)} ${i}`;
  return fit(v, f, varcharLength(f));
}

function numberIn(lo: number, hi: number, i: number, step: number, unique: boolean): number {
  if (unique) return Math.min(lo + i, hi);
  const span = Math.max(hi - lo, 1);
  return lo + ((i * step) % span);
}

function scalarValue(model: ResourceModel, f: FieldSpec, i: number): string {
  switch (f.type) {
    case 'string':
      return `'${stringValue(model, f, i)}'`;
    case 'text':
      return `'${fit(`Sample ${humanize(f.name).toLowerCase()} of ${model.name} ${i}.`, f, f.max)}'`;
    case 'int': {
      const lo = f.min ?? 0;
      return String(Math.round(numberIn(lo, f.max ?? lo + 100, i, 7, !!f.unique)));
    }
    case 'number': {
      const lo = f.min ?? 0;
      return String(Math.round(numberIn(lo, f.max ?? lo + 1000, i, 37.5, !!f.unique) * 100) / 100);
    }
    case 'decimal': {
      const limit = decimalLimit(f);
      const lo = f.min ?? 0;
      const hi = Math.min(f.max ?? lo + 1000, limit);
      const value = numberIn(lo, hi, i, 12.75, !!f.unique);
      return String(Number(value.toFixed(f.scale ?? 2)));
    }
    case 'boolean':
      return String(i % 4 !== 0);
    case 'date':
      return `new Date('${new Date(Date.UTC(2025, 0, i, 9)).toISOString()}')`;
    case 'json':
      return `{ sample: ${i} }`;
    case 'enum': {
      const values = f.enumValues!;
      const v = values[(i - 1) % values.length];
      return `${enumName(model.name, f.name)}.${enumKey(v)}`;
    }
    default:
      return 'undefined';
  }
}

/** Variable holding the rows of a referenced entity in the seed. */
function listVar(m: FieldModel): string {
  return `${strings.camelize(m.spec.name)}Rows`;
}

export interface SeedFile {
  exportName: string;
  /** Path without `.ts`, relative to the project root. */
  file: string;
  content: string;
}

export function renderSeed(model: ResourceModel, count: number): SeedFile {
  const exportName = seedExportName(model.name);
  const refs = model.fields.filter((m) => m.kind !== 'scalar');
  const imports = new Map<string, Set<string>>();
  const use = (file: string, name: string) => imports.set(file, (imports.get(file) ?? new Set()).add(name));
  use(model.name, model.className);
  for (const m of model.fields) if (m.spec.type === 'enum') use(model.name, enumName(model.name, m.spec.name));
  for (const m of refs) use(m.target!.file, m.target!.className);

  const loads: string[] = [];
  for (const m of refs) {
    const where = m.spec.type === 'file' ? `where: { kind: '${m.spec.kind}' }, ` : '';
    loads.push(
      `const ${listVar(m)} = await dataSource.getRepository(${m.target!.className}).find({ ${where}order: { createdAt: 'ASC', id: 'ASC' }, take: ${count} });`,
    );
    const required = !m.spec.nullable && (m.kind === 'one' || m.spec.min !== 0);
    if (required) {
      loads.push(
        `if (!${listVar(m)}.length) {`,
        `  console.warn('[seed ${model.name}] skipped: needs ${m.target!.className} rows${m.spec.type === 'file' ? ` (kind ${m.spec.kind})` : ''} first');`,
        '  return;',
        '}',
      );
    }
  }

  const rows: string[] = [];
  for (let i = 1; i <= count; i++) {
    const props = [`id: '${seedId(model.name, i)}'`];
    for (const m of model.fields) {
      if (m.kind === 'scalar') props.push(`${m.spec.name}: ${scalarValue(model, m.spec, i)}`);
      else if (m.kind === 'one') {
        props.push(
          m.spec.nullable
            ? `${m.key}: ${listVar(m)}[${i - 1} % ${listVar(m)}.length]?.id ?? null`
            : `${m.key}: ${listVar(m)}[${i - 1} % ${listVar(m)}.length].id`,
        );
      } else {
        props.push(`${m.spec.name}: pick(${listVar(m)}, ${i - 1})`);
      }
    }
    rows.push(`{ ${props.join(', ')} },`);
  }

  const importLines = [...imports.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, names]) => `import { ${[...names].sort().join(', ')} } from '../entities/${file}.entity';`);
  const hasMany = refs.some((m) => m.kind === 'many');
  const indentBlock = (lines: string[], n: number) => lines.map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

  const content = `import { DataSource, DeepPartial, In } from 'typeorm';
${importLines.join('\n')}
import { Seeder } from './seeder';
${
  hasMany
    ? `
/** One row of \`list\` per seeded row (empty when there are none). */
function pick<T>(list: T[], i: number): T[] {
  return list.length ? [list[i % list.length]] : [];
}
`
    : ''
}
/**
 * ${count} demo row(s) for \`${model.name}\` (development only, generated by
 * \`crud ${model.name} --seed ${count}\`). Ids are fixed: re-running adds nothing.
 */
export const ${exportName}: Seeder = {
  name: '${model.name}',
  devOnly: true,
  async run(dataSource: DataSource): Promise<void> {
    const repository = dataSource.getRepository(${model.className});
${loads.length ? `${indentBlock(loads, 4)}\n` : ''}    const rows: DeepPartial<${model.className}>[] = [
${indentBlock(rows, 6)}
    ];
    const existing = await repository.find({
      select: { id: true },
      where: { id: In(rows.map((r) => r.id as string)) },
      withDeleted: true,
    });
    const known = new Set(existing.map((r) => r.id));
    await repository.save(rows.filter((r) => !known.has(r.id as string)).map((r) => repository.create(r)));
  },
};
`;
  return { exportName, file: `${SEEDS_DIR}/${model.name}.seed`, content };
}
