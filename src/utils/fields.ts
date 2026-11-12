/**
 * `--fields` spec parser. Shared syntax for the backend (nest-schematics)
 * and the frontend (fuse-schematics), so it has no Nest/Angular dependencies.
 *
 *   "title:string,price:number,active:boolean,note:text?,status:enum(draft|published)"
 *
 * - entries are comma-separated `name:type`
 * - type: string | number | boolean | date | text | enum(a|b|c)
 * - a trailing `?` makes the field nullable/optional
 * - a missing type defaults to `string`
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'text' | 'enum';

export interface FieldSpec {
  /** Property name as written (camelCase recommended), e.g. `fullName`. */
  name: string;
  type: FieldType;
  nullable: boolean;
  /** Only for `enum`. */
  enumValues?: string[];
}

export const FIELD_TYPES: readonly FieldType[] = [
  'string',
  'number',
  'boolean',
  'date',
  'text',
  'enum',
];

/** Columns every entity already has (BaseEntity). */
export const RESERVED_FIELD_NAMES: readonly string[] = [
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
];

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENUM_VALUE_RE = /^[A-Za-z0-9_-]+$/;
const ENTRY_RE = /^([^:]+?)\s*(?::\s*([A-Za-z]+)\s*(?:\(([^)]*)\))?)?\s*(\?)?$/;

export class FieldSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldSpecError';
  }
}

/**
 * Splits on commas that are not inside `(...)`, so enum values may later use
 * either `|` or `,` without breaking the outer list.
 */
function splitEntries(spec: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of spec) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

export function parseFields(spec: string | undefined | null): FieldSpec[] {
  if (!spec || !spec.trim()) return [];

  const fields: FieldSpec[] = [];
  const seen = new Set<string>();

  for (const entry of splitEntries(spec)) {
    const match = ENTRY_RE.exec(entry);
    if (!match) {
      throw new FieldSpecError(`Invalid field "${entry}". Expected name:type, e.g. "price:number".`);
    }
    const [, rawName, rawType, rawEnum, optional] = match;
    const name = rawName.trim();
    const type = (rawType ?? 'string').toLowerCase() as FieldType;

    if (!NAME_RE.test(name)) {
      throw new FieldSpecError(`Invalid field name "${name}". Use letters, digits and _ only.`);
    }
    if (RESERVED_FIELD_NAMES.includes(name)) {
      throw new FieldSpecError(`Field "${name}" is reserved (already in BaseEntity).`);
    }
    if (seen.has(name)) {
      throw new FieldSpecError(`Field "${name}" is listed twice.`);
    }
    if (!FIELD_TYPES.includes(type)) {
      throw new FieldSpecError(
        `Unknown type "${rawType}" for "${name}". Allowed: ${FIELD_TYPES.join(', ')}.`,
      );
    }

    const field: FieldSpec = { name, type, nullable: optional === '?' };

    if (type === 'enum') {
      const values = (rawEnum ?? '')
        .split(/[|,]/)
        .map((v) => v.trim())
        .filter(Boolean);
      if (!values.length) {
        throw new FieldSpecError(
          `Enum "${name}" needs values, e.g. "${name}:enum(draft|published)".`,
        );
      }
      const bad = values.find((v) => !ENUM_VALUE_RE.test(v));
      if (bad) {
        throw new FieldSpecError(`Invalid enum value "${bad}" for "${name}".`);
      }
      field.enumValues = Array.from(new Set(values));
    } else if (rawEnum !== undefined) {
      throw new FieldSpecError(`Only enum fields take values in (...): "${entry}".`);
    }

    seen.add(name);
    fields.push(field);
  }

  return fields;
}

/** Inverse of `parseFields` (normalised form). */
export function stringifyFields(fields: FieldSpec[]): string {
  return fields
    .map((f) => {
      const type = f.type === 'enum' ? `enum(${(f.enumValues ?? []).join('|')})` : f.type;
      return `${f.name}:${type}${f.nullable ? '?' : ''}`;
    })
    .join(',');
}
