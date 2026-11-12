import { logging } from '@angular-devkit/core';
import { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import { recordFeature } from '../utils/ops';
import { createRunner, createStarterTree, snapshot } from '../testing/starter-tree';
import { defaultIndexName, primaryKeyName, readableName } from './naming';
import { seedId } from './seed';

const ENTITIES = '/libs/database/src/entities';
const MIGRATIONS = '/libs/database/src/migrations';
const SEEDS = '/libs/database/src/seeds';
const MODULES = '/apps/api/src/modules';

const CATEGORY = 'name:string:unique,slug:string(80):index,active:boolean:default(true)';
const TAG = 'name:string:unique';
const PRODUCT =
  'name:string:min(2):max(120),price:decimal(12,2):default(0),qty:int:default(0),meta:json?,' +
  'status:enum(draft|published):default(draft),category:relation(Category),tags:relation(Tag[])?';

const MEDIA_FILE_ENTITY = `import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'media_files' })
export class MediaFile extends BaseEntity {
  @Column({ type: 'varchar' })
  kind: string;

  @Column({ type: 'varchar' })
  url: string;
}
`;

function migrationFiles(tree: UnitTestTree, name?: string): string[] {
  return tree
    .getDir(MIGRATIONS)
    .subfiles.map(String)
    .filter((f) => /^\d{13}-create-/.test(f) && (!name || f.endsWith(`-create-${name}.ts`)));
}

function migration(tree: UnitTestTree, name: string): string {
  const files = migrationFiles(tree, name);
  expect(files.length).withContext(`migrations for ${name}`).toBe(1);
  return tree.readContent(`${MIGRATIONS}/${files[0]}`);
}

/** Runs the schematic and collects warnings. */
async function run(
  runner: SchematicTestRunner,
  tree: UnitTestTree,
  name: string,
  options: Record<string, unknown> = {},
): Promise<{ tree: UnitTestTree; warnings: string[] }> {
  const warnings: string[] = [];
  const sub = runner.logger.subscribe((entry: logging.LogEntry) => {
    if (entry.level === 'warn') warnings.push(entry.message);
  });
  try {
    const result = await runner.runSchematic('nest-crud', { name, ...options }, tree);
    return { tree: result, warnings };
  } finally {
    sub.unsubscribe();
  }
}

describe('nest-crud --fields v2 (starter project)', () => {
  const runner = createRunner();
  let tree: UnitTestTree;

  beforeAll(async () => {
    tree = await createStarterTree(runner);
    tree = (await run(runner, tree, 'category', { fields: CATEGORY, seed: 5 })).tree;
    tree = (await run(runner, tree, 'tag', { fields: TAG })).tree;
    tree = (await run(runner, tree, 'product', { fields: PRODUCT, seed: 10 })).tree;
  });

  describe('entity', () => {
    let entity: string;
    beforeAll(() => (entity = tree.readContent(`${ENTITIES}/product.entity.ts`)));

    it('maps decimal to numeric with a string↔number transformer', () => {
      expect(entity).toContain('const numeric: ValueTransformer = {');
      expect(entity).toContain(
        "@Column({ type: 'numeric', precision: 12, scale: 2, transformer: numeric, default: 0 })\n  price: number;",
      );
      expect(entity).toContain("@ApiProperty({ type: Number, format: 'decimal', default: 0 })");
    });

    it('maps int, json and string(min,max)', () => {
      expect(entity).toContain("@Column({ type: 'integer', default: 0 })\n  qty: number;");
      expect(entity).toContain("@Column({ type: 'jsonb', nullable: true })\n  meta?: Record<string, unknown> | null;");
      expect(entity).toContain("@ApiProperty({ type: String, minLength: 2, maxLength: 120 })");
      expect(entity).toContain("@Column({ type: 'varchar', length: 120 })");
    });

    it('uses TypeORM’s default enum type name (no enumName in @Column) and names the Swagger enum', () => {
      expect(entity).toContain("@Column({ type: 'enum', enum: ProductStatus, default: ProductStatus.Draft })");
      expect(entity).not.toContain('product_status_enum');
      expect(entity).toContain("@ApiProperty({ enum: ProductStatus, enumName: 'ProductStatus', default: 'draft' })");
    });

    it('adds a categoryId uuid column plus the ManyToOne relation (restrict by default)', () => {
      expect(entity).toContain(
        "@Index('IDX_product_category_id')\n  @Column({ type: 'uuid' })\n  categoryId: string;",
      );
      expect(entity).toContain("@ManyToOne(() => Category, { onDelete: 'RESTRICT' })");
      expect(entity).toContain(
        "@JoinColumn({ name: 'category_id', foreignKeyConstraintName: 'FK_product_category_id' })\n  category?: Relation<Category>;",
      );
      expect(entity).toContain("import { Category } from './category.entity';");
    });

    it('adds a ManyToMany join table and a tagIds (non-column) property', () => {
      expect(entity).toContain('@ManyToMany(() => Tag)');
      expect(entity).toContain("name: 'product_tags',");
      expect(entity).toContain(
        "joinColumn: { name: 'product_id', referencedColumnName: 'id', foreignKeyConstraintName: 'FK_product_tags_product_id' },",
      );
      expect(entity).toContain(
        "inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id', foreignKeyConstraintName: 'FK_product_tags_tag_id' },",
      );
      expect(entity).toContain('tags?: Relation<Tag>[];');
      expect(entity).toMatch(/x-relation[^\n]*multiple: true[^\n]*\n {2}tagIds\?: string\[\];/);
    });

    it('declares x-relation on the FK column', () => {
      expect(entity).toContain(
        "@ApiProperty({ type: String, format: 'uuid', ...{ 'x-relation': { entity: 'Category', endpoint: '/admin/category/options', label: 'name', multiple: false } } })",
      );
    });

    it('makes unique columns partial unique indexes on the soft-deleted table', () => {
      const category = tree.readContent(`${ENTITIES}/category.entity.ts`);
      expect(category).toContain(`@Index('UQ_category_name', { unique: true, where: '"deleted_at" IS NULL' })`);
      expect(category).toContain("@Index('IDX_category_slug')");
      expect(category).toContain("@Column({ type: 'varchar', length: 80 })");
      expect(category).toContain("@Column({ type: 'boolean', default: true })");
    });
  });

  describe('DTOs', () => {
    it('validates relation ids in the create DTO', () => {
      const dto = tree.readContent(`${MODULES}/product/dto/create-product.dto.ts`);
      expect(dto).toContain(
        "@ApiProperty({ type: String, format: 'uuid', ...{ 'x-relation': { entity: 'Category', endpoint: '/admin/category/options', label: 'name', multiple: false } } })\n  @IsUUID()\n  categoryId: string;",
      );
      expect(dto).toContain(
        "@ApiPropertyOptional({ type: String, format: 'uuid', isArray: true, ...{ 'x-relation': { entity: 'Tag', endpoint: '/admin/tag/options', label: 'name', multiple: true } } })\n" +
          '  @IsOptional()\n  @IsArray()\n  @ArrayUnique()\n  @IsUUID(undefined, { each: true })\n  tagIds?: string[];',
      );
    });

    it('validates scalars with explicit bounds', () => {
      const dto = tree.readContent(`${MODULES}/product/dto/create-product.dto.ts`);
      expect(dto).toContain('@MaxLength(120)\n  @MinLength(2)\n  @IsNotEmpty()\n  name: string;');
      expect(dto).toContain('@IsNumber({ maxDecimalPlaces: 2 })\n  @Min(-9999999999.99)\n  @Max(9999999999.99)\n  price?: number;');
      expect(dto).toContain('@IsInt()\n  @Min(-2147483648)\n  @Max(2147483647)\n  qty?: number;');
      expect(dto).toContain('@IsObject()\n  meta?: Record<string, unknown> | null;');
      expect(dto).toContain("@ApiPropertyOptional({ enum: ProductStatus, enumName: 'ProductStatus', default: 'draft' })");
    });

    it('makes the relation filterable in the query DTO', () => {
      const dto = tree.readContent(`${MODULES}/product/dto/query-product.dto.ts`);
      expect(dto).toContain('export class QueryProductDto extends TableQueryDto {');
      expect(dto).toContain("'x-relation': { entity: 'Category', endpoint: '/admin/category/options', label: 'name', multiple: false }");
      expect(dto).toContain('@IsOptional()\n  @IsUUID()\n  categoryId?: string;');
    });
  });

  describe('service and module', () => {
    it('wires relations, relation ids, the option label and query filters', () => {
      const service = tree.readContent(`${MODULES}/product/product.service.ts`);
      expect(service).toContain("protected override relations = ['category'];");
      expect(service).toContain("protected override detailRelations = ['tags'];");
      expect(service).toContain('categoryId: { target: Category },');
      expect(service).toContain("tagIds: { target: Tag, relation: 'tags' },");
      expect(service).toContain("protected override optionLabel = 'name';");
      expect(service).toContain("searchFields: ['name', 'category.name'],");
      expect(service).toContain("queryFilters: ['categoryId'],");
      expect(service).toContain("import { BaseCrudService, RelationIds, TableQueryOptions } from '@app/common';");
      expect(service).toContain("import { Category, Product, Tag } from '@app/database';");
    });

    it('registers target repositories in the module', () => {
      const mod = tree.readContent(`${MODULES}/product/product.module.ts`);
      expect(mod).toContain('TypeOrmModule.forFeature([Product, Category, Tag])');
      expect(mod).toContain("import { Category, Product, Tag } from '@app/database';");
    });

    it('keeps plain resources simple', () => {
      const service = tree.readContent(`${MODULES}/tag/tag.service.ts`);
      expect(service).not.toContain('RelationIds');
      expect(service).not.toContain('detailRelations');
      expect(tree.readContent(`${MODULES}/tag/tag.module.ts`)).toContain('TypeOrmModule.forFeature([Tag])');
    });

    it('keeps one decorator line per overridden pagination route in the controller', () => {
      const controller = tree.readContent(`${MODULES}/product/product.controller.ts`);
      expect(controller).toContain('QueryProductDto');
      expect(controller).toContain("@AdminResource('product', {");
      expect(controller).toContain(
        "@Post('pagination')\n  override findAllPagination(@Body() query: QueryProductDto)",
      );
    });
  });

  describe('migrations', () => {
    it('creates one migration per new resource and registers it in order', () => {
      const index = tree.readContent(`${MIGRATIONS}/index.ts`);
      const names = ['category', 'tag', 'product'].map((n) => {
        const file = migrationFiles(tree, n)[0];
        const ts = /^(\d{13})/.exec(file)![1];
        return `Create${n[0].toUpperCase()}${n.slice(1)}${ts}`;
      });
      for (const n of names) expect(index).toContain(`  ${n},`);
      const positions = names.map((n) => index.indexOf(`  ${n},`));
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      const stamps = ['category', 'tag', 'product'].map((n) => Number(migrationFiles(tree, n)[0].slice(0, 13)));
      expect(stamps[0]).toBeLessThan(stamps[1]);
      expect(stamps[1]).toBeLessThan(stamps[2]);
    });

    it('writes the table, enum type, indexes, join table and foreign keys', () => {
      const sql = migration(tree, 'product');
      expect(sql).toContain(`CREATE TYPE "public"."product_status_enum" AS ENUM('draft', 'published')`);
      expect(sql).toContain(
        `CREATE TABLE "product" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
          `"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, ` +
          `"name" character varying(120) NOT NULL, "price" numeric(12,2) NOT NULL DEFAULT '0', "qty" integer NOT NULL DEFAULT '0', ` +
          `"meta" jsonb, "status" "public"."product_status_enum" NOT NULL DEFAULT 'draft', "category_id" uuid NOT NULL, ` +
          `CONSTRAINT "${primaryKeyName('product', ['id'])}" PRIMARY KEY ("id"))`,
      );
      expect(sql).toContain(`CREATE INDEX "${defaultIndexName('product', ['deleted_at'])}" ON "product" ("deleted_at") `);
      expect(sql).toContain(`CREATE INDEX "IDX_product_category_id" ON "product" ("category_id") `);
      expect(sql).toContain(
        `CREATE TABLE "product_tags" ("product_id" uuid NOT NULL, "tag_id" uuid NOT NULL, ` +
          `CONSTRAINT "${primaryKeyName('product_tags', ['product_id', 'tag_id'])}" PRIMARY KEY ("product_id", "tag_id"))`,
      );
      expect(sql).toContain(
        `ALTER TABLE "product" ADD CONSTRAINT "FK_product_category_id" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
      );
      expect(sql).toContain(
        `ALTER TABLE "product_tags" ADD CONSTRAINT "FK_product_tags_tag_id" FOREIGN KEY ("tag_id") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
      );
      expect(sql).toContain(`DROP TYPE "public"."product_status_enum"`);
      // down() undoes up() in reverse
      const down = sql.slice(sql.indexOf('public async down'));
      expect(down.indexOf('DROP CONSTRAINT "FK_product_category_id"')).toBeLessThan(down.indexOf('DROP TABLE "product"'));
      expect(down.indexOf('DROP TABLE "product"')).toBeLessThan(down.indexOf('DROP TYPE'));
    });

    it('writes unique fields as partial unique indexes (soft delete)', () => {
      const sql = migration(tree, 'category');
      expect(sql).toContain(`CREATE UNIQUE INDEX "UQ_category_name" ON "category" ("name") WHERE "deleted_at" IS NULL`);
      expect(sql).toContain(`CREATE INDEX "IDX_category_slug" ON "category" ("slug") `);
      expect(sql).toContain(`"active" boolean NOT NULL DEFAULT true`);
    });

    it('re-running with the same fields changes nothing', async () => {
      const before = snapshot(tree);
      let again = (await run(runner, tree, 'category', { fields: CATEGORY, seed: 5 })).tree;
      again = (await run(runner, again, 'tag', { fields: TAG })).tree;
      const result = await run(runner, again, 'product', { fields: PRODUCT, seed: 10 });
      expect(result.warnings.filter((w) => /migration/i.test(w))).toEqual([]);
      const after = snapshot(result.tree);
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [file, content] of before) expect(after.get(file)).withContext(file).toBe(content);
    });

    it('changed fields on an existing resource only print a migration:generate hint', async () => {
      const before = migration(tree, 'tag');
      const result = await run(runner, tree, 'tag', { fields: 'name:string:unique,color:string(7)?', force: true });
      expect(migrationFiles(result.tree, 'tag').length).toBe(1);
      expect(migration(result.tree, 'tag')).toBe(before);
      expect(result.warnings.join('\n')).toContain('npm run migration:generate');
      expect(result.tree.readContent(`${ENTITIES}/tag.entity.ts`)).toContain('color?: string | null;');
    });
  });

  describe('permissions and seeds', () => {
    it('adds read/write permissions per resource', () => {
      const permissions = tree.readContent('/libs/common/src/permissions.ts');
      for (const n of ['category', 'tag', 'product']) {
        expect(permissions).toContain(`{ resource: '${n}', actions: ['read', 'write'] },`);
      }
    });

    it('writes a dev-only seed with N deterministic rows and registers it', () => {
      const seed = tree.readContent(`${SEEDS}/product.seed.ts`);
      expect(seed).toContain('export const productSeed: Seeder = {');
      expect(seed).toContain('devOnly: true,');
      expect((seed.match(/\{ id: '/g) ?? []).length).toBe(10);
      expect(seed).toContain(`id: '${seedId('product', 1)}'`);
      expect(seed).toContain("name: 'Product 1'");
      expect(seed).toContain('status: ProductStatus.Draft');
      expect(seed).toContain('categoryId: categoryRows[0 % categoryRows.length].id');
      expect(seed).toContain('tags: pick(tagsRows, 0)');
      expect(seed).toContain("console.warn('[seed product] skipped: needs Category rows first');");
      const category = tree.readContent(`${SEEDS}/category.seed.ts`);
      expect((category.match(/\{ id: '/g) ?? []).length).toBe(5);
      expect(category).toContain("slug: 'category-1'");
      expect(tree.exists(`${SEEDS}/tag.seed.ts`)).toBeFalse();
      const index = tree.readContent(`${SEEDS}/index.ts`);
      expect(index).toContain("import { categorySeed } from './category.seed';");
      expect(index).toContain('  categorySeed,\n  productSeed,\n');
    });

    it('seed ids are valid, stable UUIDs', () => {
      expect(seedId('product', 1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(seedId('product', 1)).toBe(seedId('product', 1));
      expect(seedId('product', 1)).not.toBe(seedId('product', 2));
    });

    it('rejects --seed outside 1..1000', async () => {
      await expectAsync(run(runner, tree, 'brand', { seed: 1001 })).toBeRejectedWithError(/seed/);
      await expectAsync(run(runner, tree, 'brand', { seed: 1.5 })).toBeRejectedWithError(/seed/);
    });
  });

  describe('relation targets', () => {
    it('fails readably when the target entity does not exist', async () => {
      await expectAsync(
        run(runner, tree, 'order', { fields: 'customer:relation(Customer)' }),
      ).toBeRejectedWithError(/needs the Customer entity[\s\S]*npm run g -- crud customer --fields "name:string"/);
    });

    it('checks label() against the target properties', async () => {
      await expectAsync(
        run(runner, tree, 'order', { fields: 'category:relation(Category):label(title)' }),
      ).toBeRejectedWithError(/label\(title\) is not a property of Category/);
      const { tree: t } = await run(runner, tree, 'order', { fields: 'category:relation(Category):label(slug)' });
      expect(t.readContent(`${MODULES}/order/dto/create-order.dto.ts`)).toContain(
        "'x-relation': { entity: 'Category', endpoint: '/admin/category/options', label: 'slug', multiple: false }",
      );
    });

    it('falls back to id as the option label when the target has no name/title', async () => {
      let t = (await run(runner, tree, 'region', { fields: 'code:int' })).tree;
      t = (await run(runner, t, 'store', { fields: 'region:relation(Region)?:set-null' })).tree;
      expect(t.readContent(`${MODULES}/region/region.service.ts`)).toContain("protected override optionLabel = 'id';");
      const entity = t.readContent(`${ENTITIES}/store.entity.ts`);
      expect(entity).toContain("label: 'id'");
      expect(entity).toContain("@ManyToOne(() => Region, { onDelete: 'SET NULL', nullable: true })");
      expect(migration(t, 'store')).toContain('ON DELETE SET NULL ON UPDATE NO ACTION');
    });

    it('supports self relations without a separate entity file', async () => {
      const { tree: t } = await run(runner, tree, 'section', { fields: 'name:string,parent:relation(Section)?:cascade' });
      const entity = t.readContent(`${ENTITIES}/section.entity.ts`);
      expect(entity).toContain("@ManyToOne(() => Section, { onDelete: 'CASCADE', nullable: true })");
      expect(entity).not.toContain("from './section.entity'");
      expect(migration(t, 'section')).toContain(`REFERENCES "section"("id") ON DELETE CASCADE`);
    });
  });

  describe('file fields', () => {
    it('require the upload add-on', async () => {
      await expectAsync(run(runner, tree, 'banner', { fields: 'image:file(image)' })).toBeRejectedWithError(
        /"upload" add-on[\s\S]*npm run g -- upload/,
      );
    });

    it('reference media_files with x-file and filter by kind', async () => {
      const base = await createStarterTree(runner);
      recordFeature(base, 'upload');
      base.create(`${ENTITIES}/media-file.entity.ts`, MEDIA_FILE_ENTITY);
      const { tree: t } = await run(runner, base, 'banner', { fields: 'title:string,image:file(image)?,docs:file(pdf)[]?' });
      const dto = t.readContent(`${MODULES}/banner/dto/create-banner.dto.ts`);
      expect(dto).toContain("...{ 'x-file': { kind: 'image', multiple: false } }");
      expect(dto).toContain("...{ 'x-file': { kind: 'pdf', multiple: true } }");
      expect(dto).toContain('imageId?: string | null;');
      expect(dto).toContain('docIds?: string[];');
      const service = t.readContent(`${MODULES}/banner/banner.service.ts`);
      expect(service).toContain("imageId: { target: MediaFile, where: { kind: 'image' } },");
      expect(service).toContain("docIds: { target: MediaFile, relation: 'docs', where: { kind: 'pdf' } },");
      const sql = migration(t, 'banner');
      expect(sql).toContain(`REFERENCES "media_files"("id") ON DELETE SET NULL`);
      expect(sql).toContain(`CREATE TABLE "banner_docs"`);
    });
  });

  describe('options', () => {
    it('--no-migration skips the migration', async () => {
      const { tree: t } = await run(runner, tree, 'brand', { fields: 'name:string', migration: false });
      expect(migrationFiles(t, 'brand')).toEqual([]);
      expect(t.readContent(`${MIGRATIONS}/index.ts`)).not.toContain('CreateBrand');
    });

    it('does not create a migration for an entity that already existed', async () => {
      const base = await createStarterTree(runner);
      base.create(`${ENTITIES}/brand.entity.ts`, "@Entity({ name: 'brand' })\nexport class Brand {}\n");
      const { tree: t, warnings } = await run(runner, base, 'brand', { fields: 'name:string', force: true });
      expect(migrationFiles(t, 'brand')).toEqual([]);
      expect(warnings.join('\n')).toContain('npm run migration:generate');
    });
  });

  describe('starter base CRUD', () => {
    it('exposes GET admin/<name>/options with read permission before :id', () => {
      const controller = tree.readContent('/libs/common/src/base/base-crud.controller.ts');
      const options = controller.indexOf("@Get('options')");
      expect(options).toBeGreaterThan(-1);
      expect(controller.lastIndexOf("@AdminAccess('read')", options)).toBeGreaterThan(-1);
      expect(options).toBeLessThan(controller.indexOf("@Get(':id')"));
      expect(controller).toContain('options(@Query() query: OptionsQueryDto)');
    });

    it('implements options, relation ids and query filters in the base service', () => {
      const service = tree.readContent('/libs/common/src/base/base-crud.service.ts');
      expect(service).toContain('async options(');
      expect(service).toContain('protected relationIds: Record<string, RelationIds> = {};');
      expect(service).toContain('protected detailRelations: string[] = [];');
      const query = tree.readContent('/libs/common/src/dto/table-query.dto.ts');
      expect(query).toContain('export class OptionsQueryDto');
      expect(query).toContain('export class OptionDto');
      expect(tree.readContent('/libs/common/src/query/table-query.ts')).toContain('queryFilters');
    });
  });
});

describe('nest-crud naming helpers', () => {
  it('match TypeORM’s DefaultNamingStrategy', () => {
    // Values TypeORM 0.3 produces for these tables/columns.
    expect(primaryKeyName('product', ['id'])).toBe('PK_bebc9158e480b949565b4dc7a82');
    expect(defaultIndexName('product', ['deleted_at'])).toBe('IDX_66066600c02e85707cc0d1ec7a');
  });

  it('keeps readable names within the 63-character Postgres limit', () => {
    const long = readableName('FK', 'a_very_long_table_name_for_testing_purposes', 'another_very_long_column_name_id');
    expect(long.length).toBeLessThanOrEqual(63);
    expect(readableName('FK', 'product', 'category_id')).toBe('FK_product_category_id');
  });
});
