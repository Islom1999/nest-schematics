import { BadRequestException } from '@nestjs/common';
import { Brackets, ObjectLiteral, SelectQueryBuilder, WhereExpressionBuilder } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { MATCH_MODES, MatchMode, PaginatedResult, TableFilterRule, TableQueryDto } from '../dto/table-query.dto';

/** Filter that is not a plain column (e.g. `status: 'expired'` computed from dates). */
export type CustomFilter = (qb: WhereExpressionBuilder, rule: TableFilterRule, param: string) => void;

export interface TableQueryOptions {
  /** Fields matched by `globalFilter` (ILIKE), e.g. ['name', 'category.name']. */
  searchFields?: string[];
  customFilters?: Record<string, CustomFilter>;
  /** Used when the request has no sortField. */
  defaultSort?: { field: string; order: 'ASC' | 'DESC' };
  /** Client field → query field, e.g. `{ categoryName: 'category.name' }`. */
  fieldMap?: Record<string, string>;
}

type Kind = 'string' | 'number' | 'date' | 'boolean' | 'enum' | 'array';

interface ResolvedField {
  /** `alias.propertyPath` — TypeORM rewrites it to the quoted column. */
  sql: string;
  column: ColumnMetadata;
  kind: Kind;
}

const NUMBER_TYPES = new Set<unknown>([
  Number,
  'int',
  'integer',
  'int2',
  'int4',
  'int8',
  'bigint',
  'smallint',
  'float',
  'double precision',
  'decimal',
  'numeric',
  'real',
]);
const DATE_TYPES = new Set<unknown>([
  Date,
  'date',
  'timestamp',
  'timestamptz',
  'timestamp with time zone',
  'timestamp without time zone',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Never filterable/sortable: a startsWith filter would leak them char by char. */
export const SECRET_FIELD = /password|token|secret|hash/i;

function kindOf(column: ColumnMetadata): Kind {
  if (column.enum) return 'enum';
  if (column.isArray) return 'array';
  if (NUMBER_TYPES.has(column.type)) return 'number';
  if (DATE_TYPES.has(column.type)) return 'date';
  if (column.type === Boolean || column.type === 'boolean') return 'boolean';
  return 'string';
}

/**
 * Resolves `field` or `alias.field` against the aliases already joined into
 * the query. Only real entity columns resolve, so client input never reaches
 * the SQL text — everything else is a 400.
 */
function resolveField<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, field: string): ResolvedField | null {
  const parts = field.split('.');
  if (parts.length > 2 || parts.some((p) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p))) {
    return null;
  }
  const [aliasName, prop] = parts.length === 2 ? parts : [qb.alias, parts[0]];
  const alias = qb.expressionMap.aliases.find((a) => a.name === aliasName && a.hasMetadata);
  const column = alias?.metadata.findColumnWithPropertyName(prop);
  if (!alias || !column || SECRET_FIELD.test(column.propertyName)) return null;
  return { sql: `${alias.name}.${column.propertyPath}`, column, kind: kindOf(column) };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n)) {
    throw new BadRequestException(`Filter "${field}" needs a number`);
  }
  return n;
}

function toDate(value: unknown, field: string): Date {
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Filter "${field}" needs a valid date`);
  }
  return d;
}

function toBoolean(value: unknown, field: string): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new BadRequestException(`Filter "${field}" needs true or false`);
}

function coerce(f: ResolvedField, value: unknown, field: string): unknown {
  if (Array.isArray(value)) return value.map((v) => coerce(f, v, field));
  switch (f.kind) {
    case 'number':
      return toNumber(value, field);
    case 'date':
      return toDate(value, field);
    case 'boolean':
      return toBoolean(value, field);
    case 'enum':
      if (!f.column.enum!.map(String).includes(String(value))) {
        throw new BadRequestException(`Invalid value for "${field}"`);
      }
      return String(value);
    default:
      return value;
  }
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** Adds one rule as a WHERE condition (`and` or `or` into `where`). */
function applyRule(
  where: WhereExpressionBuilder,
  method: 'andWhere' | 'orWhere',
  f: ResolvedField,
  rule: TableFilterRule,
  field: string,
  p: string,
): void {
  const col = f.sql;
  const text = `CAST(${col} AS TEXT)`;
  let mode: MatchMode = rule.matchMode ?? 'contains';
  if (!MATCH_MODES.includes(mode)) {
    throw new BadRequestException(`Unknown matchMode "${mode}"`);
  }
  // Enums and booleans only compare by value.
  if (f.kind === 'enum' || f.kind === 'boolean') {
    if (!['equals', 'notEquals', 'in'].includes(mode)) mode = 'equals';
  }
  // Numbers/dates: a "contains" from a plain text box means "equals".
  if ((f.kind === 'number' || f.kind === 'date') && ['contains', 'startsWith', 'endsWith'].includes(mode)) {
    mode = f.kind === 'date' ? 'dateIs' : 'equals';
  }
  const value = rule.value;

  const like = (op: 'ILIKE' | 'NOT ILIKE', pattern: string) => where[method](`${text} ${op} :${p}`, { [p]: pattern });

  switch (mode) {
    case 'startsWith':
      return void like('ILIKE', `${escapeLike(String(value))}%`);
    case 'endsWith':
      return void like('ILIKE', `%${escapeLike(String(value))}`);
    case 'contains':
      return void like('ILIKE', `%${escapeLike(String(value))}%`);
    case 'notContains':
      return void like('NOT ILIKE', `%${escapeLike(String(value))}%`);
  }

  if (mode === 'dateIs' || mode === 'dateIsNot') {
    const start = toDate(value, field);
    const end = new Date(start.getTime() + DAY_MS);
    const cond =
      mode === 'dateIs' ? `(${col} >= :${p}_s AND ${col} < :${p}_e)` : `(${col} < :${p}_s OR ${col} >= :${p}_e)`;
    return void where[method](cond, { [`${p}_s`]: start, [`${p}_e`]: end });
  }
  if (mode === 'dateBefore') {
    return void where[method](`${col} < :${p}`, { [p]: toDate(value, field) });
  }
  if (mode === 'dateAfter') {
    return void where[method](`${col} > :${p}`, { [p]: toDate(value, field) });
  }

  const v = coerce(f, value, field);
  // Free text against a uuid/varchar column: compare as text so a malformed
  // id is "no match", not a Postgres cast error.
  const eqCol = f.kind === 'string' && !(Array.isArray(v) ? v : [v]).every((x) => UUID_RE.test(String(x))) ? text : col;

  switch (mode) {
    case 'equals':
      if (Array.isArray(v)) {
        if (f.kind === 'array') return void where[method](`${col} @> :${p}`, { [p]: v });
        return void where[method](`${eqCol} IN (:...${p})`, { [p]: v });
      }
      return void where[method](`${eqCol} = :${p}`, { [p]: v });
    case 'notEquals':
      return void where[method](`${eqCol} != :${p}`, { [p]: v });
    case 'in':
      return void where[method](`${eqCol} IN (:...${p})`, { [p]: Array.isArray(v) ? v : [v] });
    case 'lt':
      return void where[method](`${col} < :${p}`, { [p]: v });
    case 'lte':
      return void where[method](`${col} <= :${p}`, { [p]: v });
    case 'gt':
      return void where[method](`${col} > :${p}`, { [p]: v });
    case 'gte':
      return void where[method](`${col} >= :${p}`, { [p]: v });
    case 'between':
      if (!Array.isArray(v) || v.length !== 2) {
        throw new BadRequestException(`Filter "${field}" needs [from, to]`);
      }
      return void where[method](`${col} BETWEEN :${p}_from AND :${p}_to`, {
        [`${p}_from`]: v[0],
        [`${p}_to`]: v[1],
      });
  }
}

/**
 * Applies a PrimeNG lazy-load request (filters, globalFilter, sort, paging)
 * to a query builder and runs it. Fields may reference any alias already
 * joined into `qb` (`category.name`); unknown fields are rejected with 400.
 */
export async function runTableQuery<M extends ObjectLiteral>(
  qb: SelectQueryBuilder<M>,
  query: TableQueryDto,
  options: TableQueryOptions = {},
): Promise<PaginatedResult<M>> {
  const rows = Math.min(Math.max(Number(query.rows) || 10, 1), 100);
  const first = Math.max(Number(query.first) || 0, 0);
  let n = 0;

  for (const [field, raw] of Object.entries(query.filters ?? {})) {
    const rules = (Array.isArray(raw) ? raw : [raw]).filter(
      (r): r is TableFilterRule => !!r && typeof r === 'object' && !isEmpty(r.value),
    );
    if (!rules.length) continue;

    const custom = options.customFilters?.[field];
    const resolved = custom ? null : resolveField(qb, options.fieldMap?.[field] ?? field);
    if (!custom && !resolved) {
      throw new BadRequestException(`Unknown filter field "${field}"`);
    }
    const or = rules[0].operator === 'or';
    qb.andWhere(
      new Brackets((w) => {
        rules.forEach((rule, i) => {
          const param = `f${n++}`;
          if (custom) return custom(w, rule, param);
          applyRule(w, or && i > 0 ? 'orWhere' : 'andWhere', resolved!, rule, field, param);
        });
      }),
    );
  }

  const search = query.globalFilter?.trim();
  if (search && options.searchFields?.length) {
    const fields = options.searchFields.map((f) => {
      const r = resolveField(qb, f);
      if (!r) throw new Error(`searchFields: unknown field ${f}`);
      return r;
    });
    qb.andWhere(
      new Brackets((w) => {
        for (const f of fields) {
          w.orWhere(`CAST(${f.sql} AS TEXT) ILIKE :global`, { global: `%${escapeLike(search)}%` });
        }
      }),
    );
  }

  if (query.sortField) {
    const sort = resolveField(qb, options.fieldMap?.[query.sortField] ?? query.sortField);
    if (!sort) {
      throw new BadRequestException(`Unknown sort field "${query.sortField}"`);
    }
    qb.orderBy(sort.sql, Number(query.sortOrder) === 1 ? 'ASC' : 'DESC');
  } else if (options.defaultSort) {
    const sort = resolveField(qb, options.fieldMap?.[options.defaultSort.field] ?? options.defaultSort.field);
    if (sort) qb.orderBy(sort.sql, options.defaultSort.order);
  }

  const [data, count] = await qb.skip(first).take(rows).getManyAndCount();
  return { count, data };
}
