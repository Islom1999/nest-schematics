import { strings } from '@angular-devkit/core';
import { FieldSpec } from '../utils/fields';

/**
 * Turns parsed `--fields` into the code snippets the nest-crud templates
 * insert (entity columns, DTO properties, imports).
 */

export interface RenderedFields {
  /** `export enum ...` blocks for the entity file. */
  entityEnums: string;
  /** Column properties for the entity class body. */
  entityColumns: string;
  /** Properties for the Create DTO class body. */
  createDtoProps: string;
  /** Named imports from `class-validator` for the Create DTO. */
  validatorImports: string;
  /** Whether the Create DTO needs `Type` from class-transformer. */
  needsTransformer: boolean;
  /** Enum names the Create DTO imports from the entity file. */
  enumImports: string[];
  /** Fields used for `globalFilter` search. */
  searchFields: string[];
  /** Example Swagger filters for the query DTO. */
  filterExample: string;
}

const indent = (lines: string[], spaces = 2) =>
  lines.map((l) => (l ? ' '.repeat(spaces) + l : l)).join('\n');

export function enumName(entity: string, field: string): string {
  return `${strings.classify(entity)}${strings.classify(field)}`;
}

function enumKey(value: string): string {
  const key = strings.classify(value.replace(/-/g, '_'));
  return /^[0-9]/.test(key) ? `_${key}` : key;
}

function tsType(entity: string, f: FieldSpec): string {
  switch (f.type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'Date';
    case 'enum':
      return enumName(entity, f.name);
    default:
      return 'string';
  }
}

function columnOptions(entity: string, f: FieldSpec): string {
  const opts: string[] = [];
  switch (f.type) {
    case 'string':
      opts.push(`type: 'varchar'`, 'length: 255');
      break;
    case 'text':
      opts.push(`type: 'text'`);
      break;
    case 'number':
      opts.push(`type: 'double precision'`);
      break;
    case 'boolean':
      opts.push(`type: 'boolean'`);
      if (!f.nullable) opts.push('default: false');
      break;
    case 'date':
      opts.push(`type: 'timestamptz'`);
      break;
    case 'enum':
      opts.push(
        `type: 'enum'`,
        `enum: ${enumName(entity, f.name)}`,
        `enumName: '${strings.underscore(entity)}_${strings.underscore(f.name)}_enum'`,
      );
      break;
  }
  if (f.nullable) opts.push('nullable: true');
  return `{ ${opts.join(', ')} }`;
}

function apiPropertyOptions(entity: string, f: FieldSpec, optional: boolean): string {
  const opts: string[] = [];
  if (f.type === 'enum') opts.push(`enum: ${enumName(entity, f.name)}`);
  if (f.type === 'date') opts.push(`type: String`, `format: 'date-time'`);
  if (f.type === 'string') opts.push('maxLength: 255');
  if (f.type === 'boolean' && !f.nullable) opts.push('default: false');
  if (f.nullable) opts.push('nullable: true');
  const decorator = optional ? 'ApiPropertyOptional' : 'ApiProperty';
  return opts.length ? `@${decorator}({ ${opts.join(', ')} })` : `@${decorator}()`;
}

export function renderFields(entity: string, fields: FieldSpec[]): RenderedFields {
  const enums: string[] = [];
  const columns: string[] = [];
  const dtoProps: string[] = [];
  const validators = new Set<string>();
  const enumImports: string[] = [];
  let needsTransformer = false;

  for (const f of fields) {
    const type = tsType(entity, f);

    if (f.type === 'enum') {
      const name = enumName(entity, f.name);
      enumImports.push(name);
      enums.push(
        [
          `export enum ${name} {`,
          ...(f.enumValues ?? []).map((v) => `  ${enumKey(v)} = '${v}',`),
          '}',
        ].join('\n'),
      );
    }

    // ── Entity column ──
    columns.push(
      [
        apiPropertyOptions(entity, f, f.nullable),
        `@Column(${columnOptions(entity, f)})`,
        `${f.name}${f.nullable ? '?' : ''}: ${type}${f.nullable ? ' | null' : ''};`,
      ].join('\n'),
    );

    // ── Create DTO property ──
    // Booleans have a DB default (false), so they are optional on create.
    const optional = f.nullable || f.type === 'boolean';
    const decorators: string[] = [apiPropertyOptions(entity, f, optional)];
    if (optional) {
      decorators.push('@IsOptional()');
      validators.add('IsOptional');
    }
    switch (f.type) {
      case 'string':
        decorators.push('@IsString()', '@MaxLength(255)');
        validators.add('IsString').add('MaxLength');
        if (!optional) {
          decorators.push('@IsNotEmpty()');
          validators.add('IsNotEmpty');
        }
        break;
      case 'text':
        decorators.push('@IsString()');
        validators.add('IsString');
        break;
      case 'number':
        decorators.push('@IsNumber()');
        validators.add('IsNumber');
        break;
      case 'boolean':
        decorators.push('@IsBoolean()');
        validators.add('IsBoolean');
        break;
      case 'date':
        decorators.push('@Type(() => Date)', '@IsDate()');
        validators.add('IsDate');
        needsTransformer = true;
        break;
      case 'enum':
        decorators.push(`@IsEnum(${enumName(entity, f.name)})`);
        validators.add('IsEnum');
        break;
    }
    dtoProps.push(
      [...decorators, `${f.name}${optional ? '?' : ''}: ${type}${f.nullable ? ' | null' : ''};`].join(
        '\n',
      ),
    );
  }

  const searchFields = fields
    .filter((f) => f.type === 'string' || f.type === 'text')
    .map((f) => f.name);

  const firstText = fields.find((f) => f.type === 'string' || f.type === 'text');
  const filterExample = firstText
    ? `{ ${firstText.name}: { value: 'abc', matchMode: 'contains' } }`
    : `{ createdAt: { value: '2025-01-01', matchMode: 'dateAfter' } }`;

  return {
    entityEnums: enums.join('\n\n'),
    entityColumns: columns.map((c) => indent(c.split('\n'))).join('\n\n'),
    createDtoProps: dtoProps.map((c) => indent(c.split('\n'))).join('\n\n'),
    validatorImports: Array.from(validators).sort().join(', '),
    needsTransformer,
    enumImports,
    searchFields,
    filterExample,
  };
}
