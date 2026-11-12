import { createHash } from 'crypto';

/**
 * Database names exactly as the starter's TypeORM setup produces them, so the
 * generated migration matches the entity metadata (`schema:log` shows no diff).
 */

/** `SnakeNamingStrategy` of the starter (libs/database/src/snake-naming.strategy.ts). */
export function snake(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

function key(table: string, columns: string[]): string {
  return `${table.replace('.', '_')}_${[...columns].sort().join('_')}`;
}

/** TypeORM `DefaultNamingStrategy.primaryKeyName`. */
export function primaryKeyName(table: string, columns: string[]): string {
  return `PK_${sha1(key(table, columns)).substring(0, 27)}`;
}

/** TypeORM `DefaultNamingStrategy.indexName` (unnamed `@Index()`, junction tables). */
export function defaultIndexName(table: string, columns: string[], where?: string): string {
  return `IDX_${sha1(key(table, columns) + (where ? `_${where}` : '')).substring(0, 26)}`;
}

/** Readable constraint/index name within Postgres' 63-byte limit: `IDX_product_slug`. */
export function readableName(prefix: string, ...parts: string[]): string {
  const name = [prefix, ...parts].join('_');
  if (name.length <= 63) return name;
  return `${name.substring(0, 54)}_${sha1(name).substring(0, 8)}`;
}
