import { strings } from '@angular-devkit/core';
import { FieldSpec, MAX_VARCHAR } from '../utils/fields';
import { FieldModel, ResourceModel, UNIQUE_WHERE, enumName } from './model';

/**
 * Turns the resource model into the code snippets the nest-crud templates
 * insert (entity columns, DTO properties, service options, imports).
 */

export interface RenderedFields {
  /** Import lines of the entity file after `BaseEntity` (related entities). */
  entityImports: string;
  /** Named imports from `typeorm` for the entity. */
  typeormImports: string;
  /** `export enum ...` blocks and helpers for the entity file. */
  entityEnums: string;
  /** Column properties for the entity class body. */
  entityColumns: string;
  /** Properties for the Create DTO class body. */
  createDtoProps: string;
  /** Named imports from `class-validator` for the Create DTO. */
  validatorImports: string;
  /** Whether the Create DTO needs `Type` from class-transformer. */
  needsTransformer: boolean;
  /** Enum names the Create DTO imports from `@app/database`. */
  enumImports: string[];
  /** Named imports from `@nestjs/swagger` for the Create DTO. */
  dtoSwaggerImports: string;
  /** Named imports from `@nestjs/swagger` for the entity. */
  entitySwaggerImports: string;
  /** Body of the query DTO (relation filters). */
  queryDtoProps: string;
  queryValidatorImports: string;
  /** Fields used for `globalFilter` search. */
  searchFields: string[];
  /** Example Swagger filters for the query DTO. */
  filterExample: string;
  /** Filterable fields listed in the query DTO comment. */
  allFieldNames: string[];
  /** Service class members (relations, relationIds, ...). */
  serviceMembers: string;
  /** `tableOptions` lines besides searchFields/defaultSort. */
  serviceTableOptions: string;
  /** Entities the service and module import from `@app/database`. */
  serviceEntityImports: string[];
  moduleEntities: string[];
  /** `GET options` label. */
  optionLabel: string;
}

const indent = (lines: string[], spaces = 2) => lines.map((l) => (l ? ' '.repeat(spaces) + l : l)).join('\n');

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

export function enumKey(value: string): string {
  const key = strings.classify(value.replace(/-/g, '_'));
  return /^[0-9]/.test(key) ? `_${key}` : key;
}

function quote(value: string): string {
  return `'${value}'`;
}

/** varchar length: `string(N)`, else `max(n)`, else 255. */
export function varcharLength(f: FieldSpec): number {
  return f.length ?? (f.max !== undefined ? Math.max(1, Math.min(f.max, MAX_VARCHAR)) : 255);
}

/** Largest absolute value a numeric(p,s) column holds. */
export function decimalLimit(f: FieldSpec): number {
  const p = f.precision ?? 12;
  const s = f.scale ?? 2;
  const intDigits = p - s;
  return Number(`${intDigits > 0 ? '9'.repeat(intDigits) : '0'}${s ? `.${'9'.repeat(s)}` : ''}`);
}

function tsType(entity: string, f: FieldSpec): string {
  switch (f.type) {
    case 'int':
    case 'number':
    case 'decimal':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'Date';
    case 'enum':
      return enumName(entity, f.name);
    case 'json':
      return 'Record<string, unknown>';
    default:
      return 'string';
  }
}

/** DB default (TypeORM `default:`) as code, or undefined. */
function columnDefault(entity: string, f: FieldSpec): string | undefined {
  const d = f.default;
  if (d === undefined) return f.type === 'boolean' && !f.nullable ? 'false' : undefined;
  switch (f.type) {
    case 'enum':
      return `${enumName(entity, f.name)}.${enumKey(String(d))}`;
    case 'date':
      return `() => 'now()'`;
    case 'json':
      return JSON.stringify(d);
    case 'string':
    case 'text':
      return quote(String(d));
    default:
      return String(d);
  }
}

function columnOptions(entity: string, f: FieldSpec): string {
  const opts: string[] = [];
  switch (f.type) {
    case 'string':
      opts.push(`type: 'varchar'`, `length: ${varcharLength(f)}`);
      break;
    case 'text':
      opts.push(`type: 'text'`);
      break;
    case 'int':
      opts.push(`type: 'integer'`);
      break;
    case 'number':
      opts.push(`type: 'double precision'`);
      break;
    case 'decimal':
      opts.push(`type: 'numeric'`, `precision: ${f.precision}`, `scale: ${f.scale}`, 'transformer: numeric');
      break;
    case 'boolean':
      opts.push(`type: 'boolean'`);
      break;
    case 'date':
      opts.push(`type: 'timestamptz'`);
      break;
    case 'json':
      opts.push(`type: 'jsonb'`);
      break;
    case 'enum':
      // No enumName: the type gets TypeORM's default name (see enumTypeName).
      opts.push(`type: 'enum'`, `enum: ${enumName(entity, f.name)}`);
      break;
  }
  const def = columnDefault(entity, f);
  if (def !== undefined) opts.push(`default: ${def}`);
  if (f.nullable) opts.push('nullable: true');
  return `{ ${opts.join(', ')} }`;
}

/** Swagger default value as code (only plain literals). */
function apiDefault(f: FieldSpec): string | undefined {
  if (f.default === undefined) return f.type === 'boolean' && !f.nullable ? 'false' : undefined;
  if (f.type === 'date') return undefined;
  if (typeof f.default === 'string') return quote(f.default);
  return typeof f.default === 'object' ? JSON.stringify(f.default) : String(f.default);
}

function extension(m: FieldModel): string | undefined {
  const f = m.spec;
  if (f.type === 'relation') {
    const value =
      `{ entity: '${m.target!.className}', endpoint: '${m.target!.route}/options', ` +
      `label: '${m.label}', multiple: ${!!f.many} }`;
    return `...{ 'x-relation': ${value} }`;
  }
  if (f.type === 'file') return `...{ 'x-file': { kind: '${f.kind}', multiple: ${!!f.many} } }`;
  return undefined;
}

/**
 * Swagger options. `type` is always explicit: TypeScript reflects `T | null`
 * as `Object`, which would reach the frontend as `{ type: 'object' }`.
 */
function apiPropertyOptions(entity: string, m: FieldModel, optional: boolean): string {
  const f = m.spec;
  const opts: string[] = [];
  switch (f.type) {
    case 'string':
      opts.push('type: String');
      if (f.min !== undefined) opts.push(`minLength: ${f.min}`);
      opts.push(`maxLength: ${varcharLength(f)}`);
      break;
    case 'text':
      // fuse-schematics renders `format: 'textarea'` as a textarea field.
      opts.push('type: String', `format: 'textarea'`);
      if (f.min !== undefined) opts.push(`minLength: ${f.min}`);
      if (f.max !== undefined) opts.push(`maxLength: ${f.max}`);
      break;
    case 'int':
    case 'number':
    case 'decimal':
      opts.push(f.type === 'int' ? `type: 'integer'` : 'type: Number');
      if (f.type === 'decimal') opts.push(`format: 'decimal'`);
      if (f.min !== undefined) opts.push(`minimum: ${f.min}`);
      if (f.max !== undefined) opts.push(`maximum: ${f.max}`);
      break;
    case 'boolean':
      opts.push('type: Boolean');
      break;
    case 'date':
      opts.push('type: String', `format: 'date-time'`);
      break;
    case 'json':
      opts.push(`type: 'object'`, 'additionalProperties: true');
      break;
    case 'enum':
      // enumName: one shared schema per enum in OpenAPI (generated clients get a named type).
      opts.push(`enum: ${enumName(entity, f.name)}`, `enumName: '${enumName(entity, f.name)}'`);
      break;
    case 'relation':
    case 'file':
      opts.push('type: String', `format: 'uuid'`);
      if (f.many) {
        opts.push('isArray: true');
        if (f.min !== undefined) opts.push(`minItems: ${f.min}`);
        if (f.max !== undefined) opts.push(`maxItems: ${f.max}`);
      }
      break;
  }
  const def = apiDefault(f);
  if (def !== undefined) opts.push(`default: ${def}`);
  if (f.nullable && !f.many) opts.push('nullable: true');
  const ext = extension(m);
  if (ext) opts.push(ext);
  const decorator = optional ? 'ApiPropertyOptional' : 'ApiProperty';
  return `@${decorator}({ ${opts.join(', ')} })`;
}

function indexDecorator(m: FieldModel): string[] {
  if (!m.index) return [];
  return [
    m.index.unique
      ? `@Index('${m.index.name}', { unique: true, where: '${UNIQUE_WHERE}' })`
      : `@Index('${m.index.name}')`,
  ];
}

interface DtoProp {
  lines: string[];
  validators: string[];
  transformer?: boolean;
}

/** Validators for one Create DTO property. */
function dtoValidators(entity: string, m: FieldModel, optional: boolean): DtoProp {
  const f = m.spec;
  const v: string[] = [];
  const lines: string[] = [];
  const add = (decorator: string, ...names: string[]) => {
    lines.push(decorator);
    v.push(...names);
  };
  if (optional) add('@IsOptional()', 'IsOptional');
  let transformer = false;
  const range = (lo?: number, hi?: number) => {
    if (lo !== undefined) add(`@Min(${lo})`, 'Min');
    if (hi !== undefined) add(`@Max(${hi})`, 'Max');
  };
  switch (f.type) {
    case 'string':
      add('@IsString()', 'IsString');
      add(`@MaxLength(${varcharLength(f)})`, 'MaxLength');
      if (f.min !== undefined) add(`@MinLength(${f.min})`, 'MinLength');
      if (!optional) add('@IsNotEmpty()', 'IsNotEmpty');
      break;
    case 'text':
      add('@IsString()', 'IsString');
      if (f.max !== undefined) add(`@MaxLength(${f.max})`, 'MaxLength');
      if (f.min !== undefined) add(`@MinLength(${f.min})`, 'MinLength');
      break;
    case 'int':
      add('@IsInt()', 'IsInt');
      range(f.min ?? INT_MIN, f.max ?? INT_MAX);
      break;
    case 'number':
      add('@IsNumber()', 'IsNumber');
      range(f.min, f.max);
      break;
    case 'decimal':
      add(`@IsNumber({ maxDecimalPlaces: ${f.scale} })`, 'IsNumber');
      range(f.min ?? -decimalLimit(f), f.max ?? decimalLimit(f));
      break;
    case 'boolean':
      add('@IsBoolean()', 'IsBoolean');
      break;
    case 'date':
      lines.push('@Type(() => Date)');
      transformer = true;
      add('@IsDate()', 'IsDate');
      break;
    case 'json':
      add('@IsObject()', 'IsObject');
      break;
    case 'enum':
      add(`@IsEnum(${enumName(entity, f.name)})`, 'IsEnum');
      break;
    case 'relation':
    case 'file':
      if (f.many) {
        add('@IsArray()', 'IsArray');
        if (!optional && f.min === undefined) add('@ArrayNotEmpty()', 'ArrayNotEmpty');
        if (f.min !== undefined) add(`@ArrayMinSize(${f.min})`, 'ArrayMinSize');
        if (f.max !== undefined) add(`@ArrayMaxSize(${f.max})`, 'ArrayMaxSize');
        add('@ArrayUnique()', 'ArrayUnique');
        add('@IsUUID(undefined, { each: true })', 'IsUUID');
      } else {
        add('@IsUUID()', 'IsUUID');
      }
      break;
  }
  return { lines, validators: v, transformer };
}

function relationTsType(m: FieldModel): string {
  return `Relation<${m.target!.className}>`;
}

export function renderFields(model: ResourceModel): RenderedFields {
  const entity = model.name;
  const enums: string[] = [];
  const columns: string[] = [];
  const dtoProps: string[] = [];
  const queryProps: string[] = [];
  const validators = new Set<string>();
  const queryValidators = new Set<string>();
  const typeorm = new Set<string>(['Column', 'Entity']);
  const enumImports: string[] = [];
  const entityImports = new Map<string, string>();
  const serviceEntities = new Set<string>([model.className]);
  let needsTransformer = false;
  let hasDecimal = false;

  const relations: string[] = [];
  const detailRelations: string[] = [];
  const relationIds: string[] = [];
  const queryFilters: string[] = [];
  const searchFields: string[] = [];

  for (const m of model.fields) {
    const f = m.spec;
    const type = tsType(entity, f);
    const isRef = m.kind !== 'scalar';
    if (isRef && m.target!.className !== model.className) {
      entityImports.set(m.target!.className, `import { ${m.target!.className} } from './${m.target!.file}.entity';`);
    }
    if (isRef) serviceEntities.add(m.target!.className);

    if (f.type === 'enum') {
      const name = enumName(entity, f.name);
      enumImports.push(name);
      enums.push(
        [`export enum ${name} {`, ...(f.enumValues ?? []).map((v) => `  ${enumKey(v)} = '${v}',`), '}'].join('\n'),
      );
    }
    if (f.type === 'decimal') hasDecimal = true;
    if (m.index) typeorm.add('Index');

    // ── Entity ──
    if (m.kind === 'scalar') {
      columns.push(
        [
          apiPropertyOptions(entity, m, f.nullable),
          ...indexDecorator(m),
          `@Column(${columnOptions(entity, f)})`,
          `${f.name}${f.nullable ? '?' : ''}: ${type}${f.nullable ? ' | null' : ''};`,
        ].join('\n'),
      );
    } else if (m.kind === 'one') {
      typeorm.add('ManyToOne').add('JoinColumn').add('Relation');
      columns.push(
        [
          apiPropertyOptions(entity, m, f.nullable),
          ...indexDecorator(m),
          `@Column({ type: 'uuid'${f.nullable ? ', nullable: true' : ''} })`,
          `${m.key}${f.nullable ? '?' : ''}: string${f.nullable ? ' | null' : ''};`,
        ].join('\n'),
        [
          `@ApiPropertyOptional({ type: () => ${m.target!.className}${f.nullable ? ', nullable: true' : ''} })`,
          `@ManyToOne(() => ${m.target!.className}, { onDelete: '${m.onDelete}'${f.nullable ? ', nullable: true' : ''} })`,
          `@JoinColumn({ name: '${m.column}', foreignKeyConstraintName: '${m.foreignKey}' })`,
          `${f.name}?: ${relationTsType(m)}${f.nullable ? ' | null' : ''};`,
        ].join('\n'),
      );
    } else {
      typeorm.add('ManyToMany').add('JoinTable').add('Relation');
      const jt = m.joinTable!;
      columns.push(
        [
          `@ApiPropertyOptional({ type: () => ${m.target!.className}, isArray: true })`,
          `@ManyToMany(() => ${m.target!.className})`,
          '@JoinTable({',
          `  name: '${jt.name}',`,
          `  joinColumn: { name: '${jt.column}', referencedColumnName: 'id', foreignKeyConstraintName: '${jt.foreignKey}' },`,
          `  inverseJoinColumn: { name: '${jt.inverseColumn}', referencedColumnName: 'id', foreignKeyConstraintName: '${jt.inverseForeignKey}' },`,
          '})',
          `${f.name}?: ${relationTsType(m)}[];`,
        ].join('\n'),
        [
          `/** Ids of \`${f.name}\` in the detail response (not a column). */`,
          apiPropertyOptions(entity, m, true),
          `${m.key}?: string[];`,
        ].join('\n'),
      );
    }

    // ── Create DTO ──
    // Fields with a DB default (booleans always have one) are optional on create.
    const optional = f.nullable || f.default !== undefined || f.type === 'boolean';
    const dto = dtoValidators(entity, m, optional);
    dto.validators.forEach((v) => validators.add(v));
    if (dto.transformer) needsTransformer = true;
    const dtoType = m.kind === 'many' ? 'string[]' : m.kind === 'one' ? 'string' : type;
    const nullableSuffix = f.nullable && m.kind !== 'many' ? ' | null' : '';
    dtoProps.push(
      [apiPropertyOptions(entity, m, optional), ...dto.lines, `${m.key}${optional ? '?' : ''}: ${dtoType}${nullableSuffix};`].join(
        '\n',
      ),
    );

    // ── Service / query ──
    if (m.kind === 'one') {
      relations.push(f.name);
      const where = f.type === 'file' ? `, where: { kind: '${f.kind}' }` : '';
      relationIds.push(`${m.key}: { target: ${m.target!.className}${where} },`);
      if (f.type === 'relation') {
        queryFilters.push(m.key);
        queryValidators.add('IsOptional').add('IsUUID');
        queryProps.push(
          [
            `@ApiPropertyOptional({ type: String, format: 'uuid', description: 'Only rows with this ${f.name} (same as filters.${m.key})', ${extension(m)} })`,
            '@IsOptional()',
            '@IsUUID()',
            `${m.key}?: string;`,
          ].join('\n'),
        );
        if (m.label && m.label !== 'id') searchFields.push(`${f.name}.${m.label}`);
      }
    } else if (m.kind === 'many') {
      detailRelations.push(f.name);
      const where = f.type === 'file' ? `, where: { kind: '${f.kind}' }` : '';
      relationIds.push(`${m.key}: { target: ${m.target!.className}, relation: '${f.name}'${where} },`);
    }
  }

  const textFields = model.fields.filter((m) => m.spec.type === 'string' || m.spec.type === 'text').map((m) => m.spec.name);
  const allSearch = [...textFields, ...searchFields];

  const firstText = model.fields.find((m) => m.spec.type === 'string' || m.spec.type === 'text');
  const firstRelation = model.fields.find((m) => m.kind === 'one' && m.spec.type === 'relation');
  const filterExample = firstText
    ? `{ ${firstText.spec.name}: { value: 'abc', matchMode: 'contains' } }`
    : firstRelation
      ? `{ ${firstRelation.key}: { value: '<uuid>', matchMode: 'equals' } }`
      : `{ createdAt: { value: '2025-01-01', matchMode: 'dateAfter' } }`;

  const members: string[] = [];
  if (relations.length) members.push(`protected override relations = [${relations.map(quote).join(', ')}];`);
  if (detailRelations.length) {
    members.push(`protected override detailRelations = [${detailRelations.map(quote).join(', ')}];`);
  }
  if (relationIds.length) {
    members.push(['protected override relationIds: Record<string, RelationIds> = {', ...relationIds.map((l) => `  ${l}`), '};'].join('\n'));
  }
  members.push(`protected override optionLabel = '${model.label}';`);

  const prelude: string[] = [...enums];
  if (hasDecimal) {
    typeorm.add('ValueTransformer');
    prelude.push(
      [
        '/** numeric ↔ number: Postgres returns numeric columns as strings. */',
        'const numeric: ValueTransformer = {',
        '  to: (value?: number | null) => value,',
        '  from: (value?: string | null) => (value === null || value === undefined ? value : Number(value)),',
        '};',
      ].join('\n'),
    );
  }

  const swaggerImports = (code: string) =>
    ['ApiProperty', 'ApiPropertyOptional'].filter((d) => code.includes(`@${d}(`)).join(', ');
  const entityColumns = columns.map((c) => indent(c.split('\n'))).join('\n\n');
  const createDtoProps = dtoProps.map((c) => indent(c.split('\n'))).join('\n\n');

  const typeormOrder = ['Column', 'Entity', 'Index', 'JoinColumn', 'JoinTable', 'ManyToMany', 'ManyToOne', 'Relation', 'ValueTransformer'];

  return {
    entityImports: [...entityImports.keys()].sort().map((k) => entityImports.get(k)!).join('\n'),
    typeormImports: typeormOrder.filter((t) => typeorm.has(t)).join(', '),
    entityEnums: prelude.join('\n\n'),
    entityColumns,
    createDtoProps,
    validatorImports: Array.from(validators).sort().join(', '),
    needsTransformer,
    enumImports,
    dtoSwaggerImports: swaggerImports(createDtoProps),
    entitySwaggerImports: swaggerImports(entityColumns),
    queryDtoProps: queryProps.map((c) => indent(c.split('\n'))).join('\n\n'),
    queryValidatorImports: Array.from(queryValidators).sort().join(', '),
    searchFields: allSearch,
    filterExample,
    allFieldNames: ['id', ...model.fields.map((m) => m.key), 'createdAt', 'updatedAt'],
    serviceMembers: members.map((c) => indent(c.split('\n'))).join('\n'),
    serviceTableOptions: queryFilters.length ? indent([`queryFilters: [${queryFilters.map(quote).join(', ')}],`], 4) : '',
    serviceEntityImports: [...serviceEntities].sort(),
    moduleEntities: [model.className, ...[...serviceEntities].filter((e) => e !== model.className).sort()],
    optionLabel: model.label,
  };
}
