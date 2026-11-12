import { strings } from '@angular-devkit/core';
import { FieldSpec } from '../utils/fields';
import { ResourceModel, UNIQUE_WHERE, enumTypeName } from './model';
import { defaultIndexName, primaryKeyName } from './naming';
import { varcharLength } from './render';

/**
 * `CREATE TABLE` migration for a new resource. The SQL is what TypeORM itself
 * would generate for the entity (same types, defaults and constraint names),
 * so `migration:generate` finds nothing to change afterwards.
 */

export const MIGRATIONS_DIR = 'libs/database/src/migrations';

export interface MigrationFile {
  className: string;
  /** Path without `.ts`, relative to the project root. */
  file: string;
  content: string;
}

export function migrationFileName(name: string, timestamp: number): string {
  return `${timestamp}-create-${name}`;
}

/** `<timestamp>-create-<name>.ts` → timestamp, for the resource `name`. */
export function findMigration(files: string[], name: string): { file: string; timestamp: number } | null {
  const re = new RegExp(`^(\\d{13})-create-${name.replace(/[-]/g, '\\-')}\\.ts$`);
  for (const file of [...files].sort()) {
    const match = re.exec(file);
    if (match) return { file, timestamp: Number(match[1]) };
  }
  return null;
}

/** Highest 13-digit timestamp prefix among migration files (0 if none). */
export function latestTimestamp(files: string[]): number {
  return files.reduce((max, f) => {
    const match = /^(\d{13})-/.exec(f);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

function sqlType(f: FieldSpec, entity: string): string {
  switch (f.type) {
    case 'string':
      return `character varying(${varcharLength(f)})`;
    case 'text':
      return 'text';
    case 'int':
      return 'integer';
    case 'number':
      return 'double precision';
    case 'decimal':
      return `numeric(${f.precision},${f.scale})`;
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'TIMESTAMP WITH TIME ZONE';
    case 'json':
      return 'jsonb';
    case 'enum':
      return `"public"."${enumTypeName(entity, f.name)}"`;
    default:
      return 'uuid';
  }
}

/** TypeORM `PostgresDriver.normalizeDefault`. */
function sqlDefault(f: FieldSpec): string | undefined {
  const d = f.default;
  if (d === undefined) return f.type === 'boolean' && !f.nullable ? 'false' : undefined;
  if (f.type === 'date') return 'now()';
  if (typeof d === 'boolean') return d ? 'true' : 'false';
  if (typeof d === 'object') return `'${JSON.stringify(d)}'`;
  return `'${d}'`;
}

function escape(sql: string): string {
  return sql.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

export function renderMigration(model: ResourceModel, timestamp: number): MigrationFile {
  const { table } = model;
  const className = `Create${strings.classify(model.name)}${timestamp}`;
  const up: string[] = [];
  const down: string[] = [];

  // Enum types
  for (const m of model.fields) {
    if (m.spec.type !== 'enum') continue;
    const type = enumTypeName(model.name, m.spec.name);
    up.push(`CREATE TYPE "public"."${type}" AS ENUM(${m.spec.enumValues!.map((v) => `'${v}'`).join(', ')})`);
    down.unshift(`DROP TYPE "public"."${type}"`);
  }

  // Table
  const columns = [
    '"id" uuid NOT NULL DEFAULT gen_random_uuid()',
    '"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()',
    '"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()',
    '"deleted_at" TIMESTAMP WITH TIME ZONE',
  ];
  for (const m of model.fields) {
    if (m.kind === 'many') continue;
    const f = m.spec;
    const type = m.kind === 'one' ? 'uuid' : sqlType(f, model.name);
    const def = m.kind === 'one' ? undefined : sqlDefault(f);
    columns.push(`"${m.column}" ${type}${f.nullable ? '' : ' NOT NULL'}${def !== undefined ? ` DEFAULT ${def}` : ''}`);
  }
  columns.push(`CONSTRAINT "${primaryKeyName(table, ['id'])}" PRIMARY KEY ("id")`);
  up.push(`CREATE TABLE "${table}" (${columns.join(', ')})`);
  down.unshift(`DROP TABLE "${table}"`);

  // Indexes (BaseEntity's deletedAt index has TypeORM's default name)
  const indexes: Array<[string, string]> = [
    [defaultIndexName(table, ['deleted_at']), `CREATE INDEX "${defaultIndexName(table, ['deleted_at'])}" ON "${table}" ("deleted_at") `],
  ];
  for (const m of model.fields) {
    if (!m.index) continue;
    indexes.push([
      m.index.name,
      m.index.unique
        ? `CREATE UNIQUE INDEX "${m.index.name}" ON "${table}" ("${m.column}") WHERE ${UNIQUE_WHERE}`
        : `CREATE INDEX "${m.index.name}" ON "${table}" ("${m.column}") `,
    ]);
  }
  for (const [name, sql] of indexes) {
    up.push(sql);
    down.unshift(`DROP INDEX "public"."${name}"`);
  }

  // Join tables
  for (const m of model.fields) {
    if (m.kind !== 'many') continue;
    const jt = m.joinTable!;
    const cols = [jt.column, jt.inverseColumn];
    up.push(
      `CREATE TABLE "${jt.name}" ("${jt.column}" uuid NOT NULL, "${jt.inverseColumn}" uuid NOT NULL, ` +
        `CONSTRAINT "${primaryKeyName(jt.name, cols)}" PRIMARY KEY ("${jt.column}", "${jt.inverseColumn}"))`,
    );
    down.unshift(`DROP TABLE "${jt.name}"`);
    for (const col of cols) {
      const name = defaultIndexName(jt.name, [col]);
      up.push(`CREATE INDEX "${name}" ON "${jt.name}" ("${col}") `);
      down.unshift(`DROP INDEX "public"."${name}"`);
    }
  }

  // Foreign keys
  for (const m of model.fields) {
    if (m.kind === 'one') {
      up.push(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${m.foreignKey}" FOREIGN KEY ("${m.column}") ` +
          `REFERENCES "${m.target!.table}"("id") ON DELETE ${m.onDelete} ON UPDATE NO ACTION`,
      );
      down.unshift(`ALTER TABLE "${table}" DROP CONSTRAINT "${m.foreignKey}"`);
    }
    if (m.kind === 'many') {
      const jt = m.joinTable!;
      up.push(
        `ALTER TABLE "${jt.name}" ADD CONSTRAINT "${jt.foreignKey}" FOREIGN KEY ("${jt.column}") ` +
          `REFERENCES "${table}"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
        `ALTER TABLE "${jt.name}" ADD CONSTRAINT "${jt.inverseForeignKey}" FOREIGN KEY ("${jt.inverseColumn}") ` +
          `REFERENCES "${m.target!.table}"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
      );
      down.unshift(
        `ALTER TABLE "${jt.name}" DROP CONSTRAINT "${jt.foreignKey}"`,
        `ALTER TABLE "${jt.name}" DROP CONSTRAINT "${jt.inverseForeignKey}"`,
      );
    }
  }

  const body = (lines: string[]) => lines.map((l) => `    await queryRunner.query(\`${escape(l)}\`);`).join('\n');
  const content = `import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates "${table}" for the \`${model.name}\` CRUD resource (generated by nest-schematics).
 * Later field changes: edit the entity, then \`npm run migration:generate -- <change>\`.
 */
export class ${className} implements MigrationInterface {
  name = '${className}';

  public async up(queryRunner: QueryRunner): Promise<void> {
${body(up)}
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
${body(down)}
  }
}
`;
  return { className, file: `${MIGRATIONS_DIR}/${migrationFileName(model.name, timestamp)}`, content };
}
