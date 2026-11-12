import { Tree } from '@angular-devkit/schematics';
import { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import * as path from 'path';

const collectionPath = path.join(__dirname, '../collection.json');

const API_MODULE = `import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
  ],
})
export class ApiModule {}
`;

function projectTree(): Tree {
  const tree = Tree.empty();
  tree.create('/apps/api/src/api.module.ts', API_MODULE);
  tree.create('/apps/api/src/auth/index.ts', '// auth');
  tree.create('/libs/database/src/base.entity.ts', '// base');
  tree.create('/libs/database/src/entities/index.ts', '// barrel\nexport {};\n');
  return tree;
}

function files(name: string, root = '/apps/api/src/modules'): string[] {
  const dir = `${root}/${name}`;
  return [
    `/libs/database/src/entities/${name}.entity.ts`,
    `${dir}/${name}.service.ts`,
    `${dir}/${name}.controller.ts`,
    `${dir}/${name}.module.ts`,
    `${dir}/dto/create-${name}.dto.ts`,
    `${dir}/dto/update-${name}.dto.ts`,
    `${dir}/dto/query-${name}.dto.ts`,
  ];
}

describe('nest-crud', () => {
  const runner = new SchematicTestRunner('nest-schematics', collectionPath);

  describe('with --fields', () => {
    let tree: UnitTestTree;

    beforeAll(async () => {
      tree = await runner.runSchematic(
        'nest-crud',
        {
          name: 'SpYear',
          fields: 'title:string,price:number,active:boolean,note:text?,startsAt:date?,status:enum(draft|published|in-review),sortOrder:number?',
        },
        projectTree(),
      );
    });

    it('puts the entity in libs/database and the rest in apps/api/src/modules', () => {
      for (const file of files('sp-year')) {
        expect(tree.exists(file)).withContext(file).toBeTrue();
      }
      expect(tree.files.filter((f) => f.endsWith('.template'))).toEqual([]);
    });

    it('maps fields to TypeORM columns', () => {
      const entity = tree.readContent('/libs/database/src/entities/sp-year.entity.ts');
      expect(entity).toContain("@Entity({ name: 'sp_year' })");
      expect(entity).toContain('export class SpYear extends BaseEntity');
      expect(entity).toContain("import { BaseEntity } from '../base.entity';");
      expect(entity).toContain("@Column({ type: 'varchar', length: 255 })\n  title: string;");
      expect(entity).toContain("@Column({ type: 'double precision' })\n  price: number;");
      expect(entity).toContain("@Column({ type: 'boolean', default: false })\n  active: boolean;");
      expect(entity).toContain("@Column({ type: 'text', nullable: true })\n  note?: string | null;");
      expect(entity).toContain("@Column({ type: 'timestamptz', nullable: true })\n  startsAt?: Date | null;");
      expect(entity).toContain('export enum SpYearStatus {');
      expect(entity).toContain("InReview = 'in-review',");
      // TypeORM's default type name (sp_year_status_enum); an explicit enumName makes migration:generate diff.
      expect(entity).toContain("@Column({ type: 'enum', enum: SpYearStatus })");
      expect(entity).not.toContain('sp_year_status_enum');
    });

    it('adds class-validator and Swagger decorators to the create DTO', () => {
      const dto = tree.readContent('/apps/api/src/modules/sp-year/dto/create-sp-year.dto.ts');
      expect(dto).toContain(
        "import { IsBoolean, IsDate, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';",
      );
      expect(dto).toContain("import { Type } from 'class-transformer';");
      expect(dto).toContain("import { SpYearStatus } from '@app/database';");
      expect(dto).toMatch(/@ApiProperty\(\{ type: String, maxLength: 255 \}\)\s+@IsString\(\)\s+@MaxLength\(255\)\s+@IsNotEmpty\(\)\s+title: string;/);
      expect(dto).toMatch(/@IsNumber\(\)\s+price: number;/);
      expect(dto).toMatch(/@IsOptional\(\)\s+@IsBoolean\(\)\s+active\?: boolean;/);
      expect(dto).toMatch(/@ApiPropertyOptional\(\{ type: String, format: 'textarea', nullable: true \}\)\s+@IsOptional\(\)\s+@IsString\(\)\s+note\?: string \| null;/);
      expect(dto).toMatch(/@Type\(\(\) => Date\)\s+@IsDate\(\)\s+startsAt\?: Date \| null;/);
      expect(dto).toMatch(/@IsEnum\(SpYearStatus\)\s+status: SpYearStatus;/);
    });

    it('gives every field an explicit Swagger type (T | null reflects as Object)', () => {
      const entity = tree.readContent('/libs/database/src/entities/sp-year.entity.ts');
      const dto = tree.readContent('/apps/api/src/modules/sp-year/dto/create-sp-year.dto.ts');
      for (const src of [entity, dto]) {
        expect(src).toMatch(/@ApiProperty\(\{ type: Number \}\)\s+(@Column\([^)]*\)\s+|@IsNumber\(\)\s+)price: number;/);
        expect(src).toContain("({ type: String, format: 'textarea', nullable: true })");
        expect(src).toContain("({ type: String, format: 'date-time', nullable: true })");
        expect(src).toContain('({ type: Boolean, default: false })');
        expect(src).toContain("({ enum: SpYearStatus, enumName: 'SpYearStatus' })");
        expect(src).toMatch(/@ApiPropertyOptional\(\{ type: Number, nullable: true \}\)\s+(@Column\([^)]*\)\s+|@IsOptional\(\)\s+@IsNumber\(\)\s+)sortOrder\?: number \| null;/);
        expect(src).not.toMatch(/@ApiProperty(Optional)?\(\{ nullable: true \}\)/);
        expect(src).not.toContain('@ApiProperty()');
      }
    });

    it('derives the update DTO with PartialType', () => {
      const dto = tree.readContent('/apps/api/src/modules/sp-year/dto/update-sp-year.dto.ts');
      expect(dto).toContain('export class UpdateSpYearDto extends PartialType(CreateSpYearDto) {}');
    });

    it('extends TableQueryDto for the pagination body', () => {
      const dto = tree.readContent('/apps/api/src/modules/sp-year/dto/query-sp-year.dto.ts');
      expect(dto).toContain('export class QuerySpYearDto extends TableQueryDto');
      expect(dto).toContain("import { TableQueryDto } from '@app/common';");
    });

    it('routes the controller at admin/<dasherized-name> with read/write permissions', () => {
      const ctrl = tree.readContent('/apps/api/src/modules/sp-year/sp-year.controller.ts');
      expect(ctrl).toContain("@AdminResource('sp-year', {");
      expect(ctrl).toContain("read: ['sp-year.read'],");
      expect(ctrl).toContain("write: ['sp-year.write'],");
      expect(ctrl).toContain('extends BaseCrudController({');
      expect(ctrl).toContain("@Post('pagination/archive')");
      expect(ctrl).toContain("import { AdminResource } from '../../auth';");
      expect(ctrl).toContain("import { SpYear } from '@app/database';");
    });

    it('searches text fields globally', () => {
      const service = tree.readContent('/apps/api/src/modules/sp-year/sp-year.service.ts');
      expect(service).toContain("searchFields: ['title', 'note'],");
      expect(service).toContain('@InjectRepository(SpYear) repository: Repository<SpYear>');
    });

    it('exports the entity from the database barrel', () => {
      expect(tree.readContent('/libs/database/src/entities/index.ts')).toBe(
        "// barrel\nexport * from './sp-year.entity';\n",
      );
    });

    it('registers the module in api.module.ts', () => {
      const appModule = tree.readContent('/apps/api/src/api.module.ts');
      expect(appModule).toContain("import { SpYearModule } from './modules/sp-year/sp-year.module';");
      expect(appModule).toContain('    ConfigModule.forRoot({ isGlobal: true }),\n    SpYearModule,');
    });

    it('does not register twice on re-run', async () => {
      const once = await runner.runSchematic('nest-crud', { name: 'sp-year' }, projectTree());
      const twice = await runner.runSchematic('nest-crud', { name: 'sp-year' }, once);
      const appModule = twice.readContent('/apps/api/src/api.module.ts');
      expect(appModule.match(/SpYearModule/g)?.length).toBe(2);
      const barrel = twice.readContent('/libs/database/src/entities/index.ts');
      expect(barrel.match(/sp-year\.entity/g)?.length).toBe(1);
    });
  });

  describe('without --fields', () => {
    it('generates a single name:string field (matches the frontend default grid)', async () => {
      const tree = await runner.runSchematic('nest-crud', { name: 'category' }, projectTree());
      const entity = tree.readContent('/libs/database/src/entities/category.entity.ts');
      expect(entity).toContain('  name: string;');
      expect(entity).not.toContain('ApiPropertyOptional');
      const dto = tree.readContent('/apps/api/src/modules/category/dto/create-category.dto.ts');
      expect(dto).not.toContain('ApiPropertyOptional');
      expect(dto).not.toContain('class-transformer');
    });
  });

  describe('options', () => {
    it('supports --path with correct relative imports', async () => {
      const tree = await runner.runSchematic('nest-crud', { name: 'order', path: 'apps/api/src/admin/shop' }, projectTree());
      for (const file of files('order', '/apps/api/src/admin/shop')) {
        expect(tree.exists(file)).withContext(file).toBeTrue();
      }
      expect(tree.readContent('/apps/api/src/admin/shop/order/order.controller.ts')).toContain(
        "import { AdminResource } from '../../../auth';",
      );
      expect(tree.readContent('/apps/api/src/api.module.ts')).toContain(
        "import { OrderModule } from './admin/shop/order/order.module';",
      );
    });

    it('picks the app from the Nest CLI sourceRoot', async () => {
      const t = projectTree();
      t.create('/apps/admin/src/admin.module.ts', API_MODULE.replace('ApiModule', 'AdminModule'));
      const tree = await runner.runSchematic('nest-crud', { name: 'tag', sourceRoot: 'apps/admin/src' }, t);
      expect(tree.exists('/apps/admin/src/modules/tag/tag.module.ts')).toBeTrue();
      expect(tree.readContent('/apps/admin/src/admin.module.ts')).toContain('TagModule');
    });

    it('adds to an empty and to a single-line imports array', async () => {
      const t = Tree.empty();
      t.create('/apps/api/src/api.module.ts', "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class ApiModule {}\n");
      let out = await runner.runSchematic('nest-crud', { name: 'a' }, t);
      expect(out.readContent('/apps/api/src/api.module.ts')).toContain('imports: [AModule]');
      expect(out.readContent('/libs/database/src/entities/index.ts')).toBe("export * from './a.entity';\n");
      out = await runner.runSchematic('nest-crud', { name: 'b' }, out);
      expect(out.readContent('/apps/api/src/api.module.ts')).toContain('imports: [AModule, BModule]');
    });

    it('--skipImport leaves api.module.ts untouched', async () => {
      const tree = await runner.runSchematic('nest-crud', { name: 'tag', skipImport: true }, projectTree());
      expect(tree.readContent('/apps/api/src/api.module.ts')).toBe(API_MODULE);
    });

    it('accepts the options the Nest CLI passes', async () => {
      const tree = await runner.runSchematic(
        'nest-crud',
        { name: 'tag', language: 'ts', sourceRoot: 'apps/api/src', spec: true, flat: false },
        projectTree(),
      );
      expect(tree.exists('/apps/api/src/modules/tag/tag.module.ts')).toBeTrue();
    });

    it('rejects an invalid --fields spec', async () => {
      await expectAsync(
        runner.runSchematic('nest-crud', { name: 'tag', fields: 'price:money' }, projectTree()),
      ).toBeRejectedWithError(/--fields: Unknown type "money"/);
    });

    it('rejects an invalid resource name', async () => {
      await expectAsync(
        runner.runSchematic('nest-crud', { name: '1tag' }, projectTree()),
      ).toBeRejectedWithError(/Invalid resource name/);
    });
  });
});
