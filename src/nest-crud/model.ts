import { strings } from '@angular-devkit/core';
import { FieldSpec, fieldKey, singular } from '../utils/fields';
import { readableName, snake } from './naming';

/** An entity a relation/file field points at. */
export interface TargetInfo {
  className: string;
  /** Entity file name without `.entity.ts`, e.g. `category`. */
  file: string;
  table: string;
  /** Default display field: `name`, `title` or `id`. */
  label: string;
  /** Property names of the target class (to check `label(...)`). */
  properties: string[];
  /** Admin route of the target's CRUD resource (`/admin/category`). */
  route: string;
}

export type OnDelete = 'CASCADE' | 'SET NULL' | 'RESTRICT';

export interface FieldModel {
  spec: FieldSpec;
  /** DTO / JSON property: `price`, `categoryId`, `tagIds`. */
  key: string;
  /** scalar column, ManyToOne (relation or file) or ManyToMany. */
  kind: 'scalar' | 'one' | 'many';
  /** DB column (scalar and ManyToOne). */
  column?: string;
  target?: TargetInfo;
  /** Display field of a relation target. */
  label?: string;
  onDelete?: OnDelete;
  /** Index on the column (`index`, `unique`, every ManyToOne). */
  index?: { name: string; unique: boolean };
  /** ManyToOne foreign key. */
  foreignKey?: string;
  /** ManyToMany join table. */
  joinTable?: {
    name: string;
    column: string;
    inverseColumn: string;
    foreignKey: string;
    inverseForeignKey: string;
  };
}

export interface ResourceModel {
  /** Dasherized resource name, e.g. `sp-year`. */
  name: string;
  className: string;
  table: string;
  fields: FieldModel[];
  /** `GET options` label of this resource. */
  label: string;
}

export const LABEL_CANDIDATES = ['name', 'title'];

export function pickLabel(properties: string[]): string {
  return LABEL_CANDIDATES.find((p) => properties.includes(p)) ?? 'id';
}

export function enumName(entity: string, field: string): string {
  return `${strings.classify(entity)}${strings.classify(field)}`;
}

/**
 * Postgres enum type: TypeORM's built name `<table>_<column>_enum`. The entity
 * must not set `enumName` to it: TypeORM reads a default-named type back as
 * "no enumName", so an explicit one makes `migration:generate` diff forever.
 */
export function enumTypeName(entity: string, field: string): string {
  return `${strings.underscore(entity)}_${snake(field)}_enum`;
}

/** Soft-deleted rows do not block a unique value. */
export const UNIQUE_WHERE = '"deleted_at" IS NULL';

export function buildModel(name: string, fields: FieldSpec[], targets: Record<string, TargetInfo>): ResourceModel {
  const className = strings.classify(name);
  const table = strings.underscore(name);
  const label = pickLabel(fields.map((f) => f.name));

  const models = fields.map((spec): FieldModel => {
    const key = fieldKey(spec);
    if (spec.type !== 'relation' && spec.type !== 'file') {
      const column = snake(spec.name);
      const index =
        spec.unique || spec.index
          ? { name: readableName(spec.unique ? 'UQ' : 'IDX', table, column), unique: !!spec.unique }
          : undefined;
      return { spec, key, kind: 'scalar', column, index };
    }

    const targetName = spec.type === 'file' ? 'MediaFile' : spec.target!;
    const target = targets[targetName];
    if (!target) throw new Error(`Internal: no target info for ${targetName}`);
    const fieldLabel = spec.type === 'relation' ? (spec.label ?? target.label) : undefined;

    if (spec.many) {
      const jt = readableName(table, snake(spec.name)).replace(/^_/, '');
      const column = `${snake(className)}_id`;
      let inverseColumn = `${snake(target.className)}_id`;
      if (inverseColumn === column) inverseColumn = `${snake(singular(spec.name))}_id`;
      if (inverseColumn === column) inverseColumn = 'related_id';
      return {
        spec,
        key,
        kind: 'many',
        target,
        label: fieldLabel,
        joinTable: {
          name: jt,
          column,
          inverseColumn,
          foreignKey: readableName('FK', jt, column),
          inverseForeignKey: readableName('FK', jt, inverseColumn),
        },
      };
    }

    const column = snake(key);
    const onDelete: OnDelete =
      spec.onDelete === 'cascade' ? 'CASCADE' : spec.onDelete === 'set-null' || spec.nullable ? 'SET NULL' : 'RESTRICT';
    return {
      spec,
      key,
      kind: 'one',
      column,
      target,
      label: fieldLabel,
      onDelete,
      index: { name: readableName(spec.unique ? 'UQ' : 'IDX', table, column), unique: !!spec.unique },
      foreignKey: readableName('FK', table, column),
    };
  });

  return { name, className, table, fields: models, label };
}
