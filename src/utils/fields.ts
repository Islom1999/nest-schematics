/**
 * `--fields` spec parser. Shared syntax for the backend (nest-schematics)
 * and the frontend (fuse-schematics), so it has no Nest/Angular dependencies.
 * Copy it with `node scripts/sync-fields.mjs <dir>`; both packages test it
 * against the same examples (`fields-contract.json`).
 *
 *   "name:string:unique,price:decimal(12,2):default(0),category:relation(Category),tags:relation(Tag[])?"
 *
 * - entries are comma-separated `name:type[:modifier...]` (commas inside `(...)` do not split)
 * - a trailing `?` makes the field nullable/optional; a missing type is `string`
 * - types: string | string(N) | text | int | number | decimal(p,s) | boolean | date | json
 *          | enum(a|b) | relation(Entity) | relation(Entity[]) | file(kind) | file(kind)[]
 * - modifiers: unique | index | default(v) | min(n) | max(n) | cascade | set-null | label(field)
 */

export type FieldType =
  | 'string'
  | 'text'
  | 'int'
  | 'number'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'json'
  | 'enum'
  | 'relation'
  | 'file';

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'other';

export type FieldDefault = string | number | boolean | Record<string, unknown> | unknown[];

export interface FieldSpec {
  /** Property name as written (camelCase recommended), e.g. `fullName`. */
  name: string;
  type: FieldType;
  nullable: boolean;
  /** `enum` only. */
  enumValues?: string[];
  /** `string(N)` only: varchar length. */
  length?: number;
  /** `decimal(p,s)` only (`decimal` alone = 12,2). */
  precision?: number;
  scale?: number;
  /** `relation` only: target entity class, e.g. `Category`. */
  target?: string;
  /** `file` only. */
  kind?: FileKind;
  /** `relation` and `file`: `Entity[]` / `kind[]` = many (ManyToMany). */
  many?: boolean;
  unique?: boolean;
  index?: boolean;
  /** Typed by field type: boolean, number, string, `'now'` (date) or JSON (json). */
  default?: FieldDefault;
  /** String/text length, number range, or item count for many relations/files. */
  min?: number;
  max?: number;
  /** Single relation/file only; default: set-null when nullable, restrict otherwise. */
  onDelete?: 'cascade' | 'set-null';
  /** `relation` only: display field of the target (default: name, title or id). */
  label?: string;
}

export const FIELD_TYPES: readonly FieldType[] = [
  'string',
  'text',
  'int',
  'number',
  'decimal',
  'boolean',
  'date',
  'json',
  'enum',
  'relation',
  'file',
];

export const FILE_KINDS: readonly FileKind[] = ['image', 'video', 'audio', 'pdf', 'other'];

export const FIELD_MODIFIERS: readonly string[] = [
  'unique',
  'index',
  'default',
  'min',
  'max',
  'cascade',
  'set-null',
  'label',
];

/** Columns every entity already has (BaseEntity). */
export const RESERVED_FIELD_NAMES: readonly string[] = ['id', 'createdAt', 'updatedAt', 'deletedAt'];

export const DEFAULT_DECIMAL = { precision: 12, scale: 2 } as const;
export const MAX_VARCHAR = 10485760;

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENUM_VALUE_RE = /^[A-Za-z0-9_-]+$/;
const TARGET_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const TYPE_RE = /^([A-Za-z]+)\s*(?:\(([\s\S]*)\))?\s*(\[\])?\s*(\?)?$/;
const MODIFIER_RE = /^([A-Za-z-]+)\s*(?:\(([\s\S]*)\))?$/;
/** Characters that could break out of a quoted default in generated TS/SQL. */
const UNSAFE_DEFAULT_RE = /['`\\]|\$\{/;

export class FieldSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldSpecError';
  }
}

/** Splits on `sep` outside `(...)`. */
function splitTop(spec: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of spec) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim());
}

/** `category` / `sp-year` / `SpYear` → `Category` / `SpYear` / `SpYear`. */
export function classifyName(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('');
}

/** Naive singular for id keys: `tags` → `tag`, `categories` → `category`, `news` stays. */
export function singular(name: string): string {
  if (/ies$/.test(name) && name.length > 3) return `${name.slice(0, -3)}y`;
  if (/(ss|us|is|news)$/.test(name)) return name;
  if (/s$/.test(name) && name.length > 1) return name.slice(0, -1);
  return name;
}

/**
 * Property the DTO / form / JSON uses for a field: `category` → `categoryId`,
 * `tags` (many) → `tagIds`, `image:file(image)` → `imageId`, anything else → its name.
 */
export function fieldKey(f: Pick<FieldSpec, 'name' | 'type' | 'many'>): string {
  if (f.type !== 'relation' && f.type !== 'file') return f.name;
  return f.many ? `${singular(f.name)}Ids` : `${f.name}Id`;
}

function toNumber(raw: string, what: string, name: string): number {
  const n = Number(raw.trim());
  if (raw.trim() === '' || !Number.isFinite(n)) {
    throw new FieldSpecError(`${what} of "${name}" must be a number, got "${raw}".`);
  }
  return n;
}

function toCount(raw: string, what: string, name: string, min = 0): number {
  const n = toNumber(raw, what, name);
  if (!Number.isInteger(n) || n < min) {
    throw new FieldSpecError(`${what} of "${name}" must be an integer >= ${min}, got "${raw}".`);
  }
  return n;
}

function parseType(field: FieldSpec, rawType: string, rawArgs: string | undefined, arrayMark: boolean, entry: string): void {
  const { name } = field;
  const type = field.type;
  const noArgs = () => {
    if (rawArgs !== undefined) {
      throw new FieldSpecError(`Type "${rawType}" takes no arguments: "${entry}".`);
    }
  };
  if (arrayMark && type !== 'relation' && type !== 'file') {
    throw new FieldSpecError(`Only relation and file fields can be lists ([]): "${entry}".`);
  }
  switch (type) {
    case 'string':
      if (rawArgs !== undefined) {
        const length = toCount(rawArgs, 'Length', name, 1);
        if (length > MAX_VARCHAR) throw new FieldSpecError(`Length of "${name}" must be <= ${MAX_VARCHAR}.`);
        field.length = length;
      }
      break;
    case 'decimal': {
      if (rawArgs === undefined) {
        field.precision = DEFAULT_DECIMAL.precision;
        field.scale = DEFAULT_DECIMAL.scale;
        break;
      }
      const parts = rawArgs.split(',').map((p) => p.trim());
      if (parts.length > 2) throw new FieldSpecError(`Decimal "${name}" takes (precision,scale), e.g. decimal(12,2).`);
      const precision = toCount(parts[0], 'Precision', name, 1);
      const scale = parts.length > 1 ? toCount(parts[1], 'Scale', name) : 0;
      if (precision > 1000 || scale > precision) {
        throw new FieldSpecError(`Decimal "${name}" needs 1 <= precision <= 1000 and scale <= precision.`);
      }
      field.precision = precision;
      field.scale = scale;
      break;
    }
    case 'enum': {
      const values = (rawArgs ?? '')
        .split(/[|,]/)
        .map((v) => v.trim())
        .filter(Boolean);
      if (!values.length) {
        throw new FieldSpecError(`Enum "${name}" needs values, e.g. "${name}:enum(draft|published)".`);
      }
      const bad = values.find((v) => !ENUM_VALUE_RE.test(v));
      if (bad) throw new FieldSpecError(`Invalid enum value "${bad}" for "${name}".`);
      field.enumValues = Array.from(new Set(values));
      break;
    }
    case 'relation': {
      let target = (rawArgs ?? '').trim();
      let many = arrayMark;
      if (target.endsWith('[]')) {
        target = target.slice(0, -2).trim();
        many = true;
      }
      if (!target) {
        throw new FieldSpecError(`Relation "${name}" needs a target entity, e.g. "${name}:relation(Category)".`);
      }
      if (!TARGET_RE.test(target)) throw new FieldSpecError(`Invalid relation target "${target}" for "${name}".`);
      field.target = classifyName(target);
      field.many = many;
      break;
    }
    case 'file': {
      let kind = (rawArgs ?? '').trim();
      let many = arrayMark;
      if (kind.endsWith('[]')) {
        kind = kind.slice(0, -2).trim();
        many = true;
      }
      if (!FILE_KINDS.includes(kind.toLowerCase() as FileKind)) {
        throw new FieldSpecError(
          `File "${name}" needs a kind: file(${FILE_KINDS.join('|')}), e.g. "${name}:file(image)".`,
        );
      }
      field.kind = kind.toLowerCase() as FileKind;
      field.many = many;
      break;
    }
    default:
      noArgs();
  }
}

function parseDefault(field: FieldSpec, raw: string): FieldDefault {
  const { name, type } = field;
  const value = raw.trim();
  switch (type) {
    case 'boolean':
      if (!/^(true|false)$/i.test(value)) throw new FieldSpecError(`Default of "${name}" must be true or false.`);
      return value.toLowerCase() === 'true';
    case 'int': {
      const n = toNumber(value, 'Default', name);
      if (!Number.isInteger(n)) throw new FieldSpecError(`Default of "${name}" must be an integer.`);
      return n;
    }
    case 'number':
      return toNumber(value, 'Default', name);
    case 'decimal': {
      const n = toNumber(value, 'Default', name);
      const decimals = (value.split('.')[1] ?? '').replace(/0+$/, '').length;
      if (decimals > (field.scale ?? 0)) {
        throw new FieldSpecError(`Default of "${name}" has more than ${field.scale} decimal places.`);
      }
      return n;
    }
    case 'enum':
      if (!field.enumValues!.includes(value)) {
        throw new FieldSpecError(`Default of "${name}" must be one of ${field.enumValues!.join(', ')}.`);
      }
      return value;
    case 'date':
      if (value.toLowerCase() !== 'now') throw new FieldSpecError(`Default of date "${name}" can only be now.`);
      return 'now';
    case 'json':
      try {
        const parsed = JSON.parse(value);
        if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
        return parsed;
      } catch {
        throw new FieldSpecError(`Default of "${name}" must be a JSON object or array, e.g. default({}).`);
      }
    case 'string':
    case 'text':
      if (UNSAFE_DEFAULT_RE.test(value)) {
        throw new FieldSpecError(`Default of "${name}" cannot contain quotes, backticks, backslashes or \${.`);
      }
      return value;
    default:
      throw new FieldSpecError(`${type} field "${name}" cannot have a default.`);
  }
}

function applyModifier(field: FieldSpec, raw: string, seen: Set<string>, entry: string): void {
  const match = MODIFIER_RE.exec(raw);
  if (!raw || !match) throw new FieldSpecError(`Invalid modifier "${raw}" in "${entry}".`);
  const mod = match[1].toLowerCase();
  const arg = match[2];
  if (!FIELD_MODIFIERS.includes(mod)) {
    throw new FieldSpecError(`Unknown modifier "${match[1]}" in "${entry}". Allowed: ${FIELD_MODIFIERS.join(', ')}.`);
  }
  if (seen.has(mod)) throw new FieldSpecError(`Modifier "${mod}" is listed twice in "${entry}".`);
  seen.add(mod);
  const needsArg = ['default', 'min', 'max', 'label'].includes(mod);
  if (needsArg && arg === undefined) throw new FieldSpecError(`Modifier "${mod}" needs a value, e.g. ${mod}(…): "${entry}".`);
  if (!needsArg && arg !== undefined) throw new FieldSpecError(`Modifier "${mod}" takes no value: "${entry}".`);

  const { name, type } = field;
  const isRef = type === 'relation' || type === 'file';
  switch (mod) {
    case 'unique':
    case 'index':
      if (type === 'json' || field.many) {
        throw new FieldSpecError(`"${mod}" is not supported on ${field.many ? 'list' : type} field "${name}".`);
      }
      field[mod] = true;
      break;
    case 'default':
      field.default = parseDefault(field, arg!);
      break;
    case 'min':
    case 'max': {
      const sized = ['string', 'text'].includes(type) || (isRef && field.many);
      if (sized) field[mod] = toCount(arg!, mod, name);
      else if (['int', 'number', 'decimal'].includes(type)) {
        field[mod] = toNumber(arg!, mod, name);
        if (type === 'int' && !Number.isInteger(field[mod])) throw new FieldSpecError(`${mod} of "${name}" must be an integer.`);
      } else {
        throw new FieldSpecError(`"${mod}" applies to string, text, int, number, decimal and list fields, not "${name}".`);
      }
      break;
    }
    case 'cascade':
    case 'set-null':
      if (!isRef || field.many) {
        throw new FieldSpecError(`"${mod}" applies to single relation/file fields only, not "${name}".`);
      }
      field.onDelete = mod;
      break;
    case 'label':
      if (type !== 'relation') throw new FieldSpecError(`"label" applies to relation fields only, not "${name}".`);
      if (!NAME_RE.test(arg!.trim())) throw new FieldSpecError(`Invalid label field "${arg}" for "${name}".`);
      field.label = arg!.trim();
      break;
  }
}

function checkField(field: FieldSpec): void {
  const { name } = field;
  if (field.unique && field.index) {
    throw new FieldSpecError(`"${name}": use either unique or index (a unique index is already an index).`);
  }
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
    throw new FieldSpecError(`"${name}": min (${field.min}) is greater than max (${field.max}).`);
  }
  if (field.type === 'string' && field.length !== undefined && field.max !== undefined && field.max > field.length) {
    throw new FieldSpecError(`"${name}": max (${field.max}) is greater than the column length (${field.length}).`);
  }
  if (field.onDelete === 'set-null' && !field.nullable) {
    throw new FieldSpecError(`"${name}": set-null needs a nullable field (add ? at the end).`);
  }
  if ((field.type === 'relation' || field.type === 'file') && /Ids?$/.test(name)) {
    throw new FieldSpecError(
      `Name the ${field.type} "${name}" without the Id suffix (e.g. "${name.replace(/Ids?$/, '')}"); ` +
        `the generator adds "${fieldKey({ ...field, name: name.replace(/Ids?$/, '') })}".`,
    );
  }
  const d = field.default;
  if (typeof d === 'number') {
    if (field.min !== undefined && d < field.min) throw new FieldSpecError(`Default of "${name}" is below min (${field.min}).`);
    if (field.max !== undefined && d > field.max) throw new FieldSpecError(`Default of "${name}" is above max (${field.max}).`);
  }
  if (typeof d === 'string' && (field.type === 'string' || field.type === 'text')) {
    const limit = field.max ?? field.length;
    if (limit !== undefined && d.length > limit) throw new FieldSpecError(`Default of "${name}" is longer than ${limit}.`);
    if (field.min !== undefined && d.length < field.min) throw new FieldSpecError(`Default of "${name}" is shorter than ${field.min}.`);
  }
}

export function parseFields(spec: string | undefined | null): FieldSpec[] {
  if (!spec || !spec.trim()) return [];

  const fields: FieldSpec[] = [];
  const seen = new Set<string>();

  for (const raw of splitTop(spec, ',').filter((s) => s.length > 0)) {
    let entry = raw;
    let nullable = false;
    if (entry.endsWith('?')) {
      nullable = true;
      entry = entry.slice(0, -1).trimEnd();
    }
    const parts = splitTop(entry, ':');
    const name = parts[0].endsWith('?') && parts.length === 1 ? parts[0].slice(0, -1).trim() : parts[0];
    if (!name || parts.slice(1).some((p) => !p)) {
      throw new FieldSpecError(`Invalid field "${raw}". Expected name:type, e.g. "price:number".`);
    }
    if (!NAME_RE.test(name)) {
      throw new FieldSpecError(`Invalid field name "${name}". Use letters, digits and _ only.`);
    }
    if (RESERVED_FIELD_NAMES.includes(name)) {
      throw new FieldSpecError(`Field "${name}" is reserved (already in BaseEntity).`);
    }

    let type: FieldType = 'string';
    let typeMatch: RegExpExecArray | null = null;
    if (parts.length > 1) {
      typeMatch = TYPE_RE.exec(parts[1]);
      if (!typeMatch) throw new FieldSpecError(`Invalid type "${parts[1]}" in "${raw}".`);
      type = typeMatch[1].toLowerCase() as FieldType;
      if (!FIELD_TYPES.includes(type)) {
        throw new FieldSpecError(`Unknown type "${typeMatch[1]}" for "${name}". Allowed: ${FIELD_TYPES.join(', ')}.`);
      }
      if (typeMatch[4]) nullable = true;
    }

    const field: FieldSpec = { name, type, nullable };
    if (typeMatch) parseType(field, typeMatch[1], typeMatch[2], !!typeMatch[3], raw);

    const mods = new Set<string>();
    for (const mod of parts.slice(2)) applyModifier(field, mod, mods, raw);
    checkField(field);

    for (const key of new Set([name, fieldKey(field)])) {
      if (RESERVED_FIELD_NAMES.includes(key)) throw new FieldSpecError(`Field "${key}" is reserved (already in BaseEntity).`);
      if (seen.has(key)) throw new FieldSpecError(`Field "${key}" is listed twice.`);
      seen.add(key);
    }
    fields.push(order(field));
  }

  return fields;
}

/** Stable key order, so parsed JSON is comparable across packages. */
function order(f: FieldSpec): FieldSpec {
  const keys: (keyof FieldSpec)[] = [
    'name',
    'type',
    'nullable',
    'enumValues',
    'length',
    'precision',
    'scale',
    'target',
    'kind',
    'many',
    'unique',
    'index',
    'default',
    'min',
    'max',
    'onDelete',
    'label',
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (f[k] !== undefined) out[k] = f[k];
  return out as unknown as FieldSpec;
}

function formatDefault(value: FieldDefault): string {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** One field in normalised `name:type[:modifier...][?]` form. */
export function stringifyField(f: FieldSpec): string {
  let type: string = f.type;
  switch (f.type) {
    case 'string':
      if (f.length !== undefined) type = `string(${f.length})`;
      break;
    case 'decimal':
      type = `decimal(${f.precision ?? DEFAULT_DECIMAL.precision},${f.scale ?? DEFAULT_DECIMAL.scale})`;
      break;
    case 'enum':
      type = `enum(${(f.enumValues ?? []).join('|')})`;
      break;
    case 'relation':
      type = `relation(${f.target}${f.many ? '[]' : ''})`;
      break;
    case 'file':
      type = `file(${f.kind})${f.many ? '[]' : ''}`;
      break;
  }
  const mods: string[] = [];
  if (f.unique) mods.push('unique');
  if (f.index) mods.push('index');
  if (f.default !== undefined) mods.push(`default(${formatDefault(f.default)})`);
  if (f.min !== undefined) mods.push(`min(${f.min})`);
  if (f.max !== undefined) mods.push(`max(${f.max})`);
  if (f.onDelete) mods.push(f.onDelete);
  if (f.label) mods.push(`label(${f.label})`);
  return [`${f.name}:${type}`, ...mods].join(':') + (f.nullable ? '?' : '');
}

/** Inverse of `parseFields` (normalised form): `parseFields(stringifyFields(x))` equals `x`. */
export function stringifyFields(fields: FieldSpec[]): string {
  return fields.map(stringifyField).join(',');
}
