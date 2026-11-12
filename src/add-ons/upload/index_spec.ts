import { logging } from '@angular-devkit/core';
import { HostTree } from '@angular-devkit/schematics';
import { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import { recordFeature } from '../../utils/ops';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';

const MEDIA = '/libs/common/src/media';
const MEDIA_MODULE = `${MEDIA}/media.module.ts`;
const ROUTES = '/apps/api/src/modules/media';
const ROUTES_MODULE = `${ROUTES}/media-routes.module.ts`;
const JOB = '/apps/worker/src/jobs/media-cleanup.job.ts';
const WORKER_MODULE = '/apps/worker/src/worker.module.ts';

/** The auth-client contract (apps/api/src/client-auth/index.ts), as another add-on will provide it. */
const CLIENT_AUTH_STUB = `import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';

export interface UserPrincipal {
  id: string;
  sessionId: string;
}

@Injectable()
export class UserGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserPrincipal => ctx.switchToHttp().getRequest<{ user: UserPrincipal }>().user,
);
`;

interface RunResult {
  tree: UnitTestTree;
  logs: logging.LogEntry[];
}

async function run(runner: SchematicTestRunner, name: string, options: Record<string, unknown>, tree: UnitTestTree): Promise<RunResult> {
  const logs: logging.LogEntry[] = [];
  const sub = runner.logger.subscribe((entry) => logs.push(entry));
  try {
    return { tree: await runner.runSchematic(name, { skipInstall: true, ...options }, tree.branch() as UnitTestTree), logs };
  } finally {
    sub.unsubscribe();
  }
}

function migrationFile(tree: UnitTestTree): string {
  const files = tree.files.filter((f) => /^\/libs\/database\/src\/migrations\/\d{13}-media-files\.ts$/.test(f));
  expect(files.length).toBe(1);
  return files[0];
}

function manifest(tree: UnitTestTree) {
  return JSON.parse(tree.readContent('/nest-schematics.json')).features as Record<string, { options?: Record<string, unknown>; items?: string[] }>;
}

function pkg(tree: UnitTestTree) {
  return JSON.parse(tree.readContent('/package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
}

async function expectIdempotent(runner: SchematicTestRunner, tree: UnitTestTree, options: Record<string, unknown> = {}) {
  const before = snapshot(tree);
  const again = await run(runner, 'upload', options, tree);
  expect(snapshot(again.tree)).toEqual(before);
  expect(again.logs.filter((l) => l.level === 'warn').map((l) => l.message)).toEqual([]);
}

describe('upload add-on', () => {
  const runner = createRunner();
  let starter: UnitTestTree;
  let local: RunResult;

  beforeAll(async () => {
    starter = await createStarterTree(runner);
    local = await run(runner, 'upload', {}, starter);
  });

  describe('--storage local (default)', () => {
    it('adds the MediaFile entity with named enums and indexes, exported from the barrel', () => {
      const entity = local.tree.readContent('/libs/database/src/entities/media-file.entity.ts');
      expect(entity).toContain("@Entity({ name: 'media_files' })");
      expect(entity).toContain('export class MediaFile extends BaseEntity');
      expect(entity).toContain("@ApiProperty({ enum: MediaKind, enumName: 'MediaKind' })");
      expect(entity).toContain("@Index('IDX_media_files_used_created_at', ['used', 'createdAt'])");
      expect(entity).toContain("@Index('IDX_media_files_owner', ['ownerType', 'ownerId'])");
      expect(entity).toContain("@Column({ type: 'bigint', transformer: bigintNumber })");
      for (const kind of ["IMAGE = 'image'", "VIDEO = 'video'", "AUDIO = 'audio'", "PDF = 'pdf'", "OTHER = 'other'"]) {
        expect(entity).toContain(kind);
      }
      expect(local.tree.readContent('/libs/database/src/entities/index.ts')).toContain("export * from './media-file.entity';");
    });

    it('adds a registered migration that matches the entity', () => {
      const file = migrationFile(local.tree);
      const ts = /(\d{13})/.exec(file)![1];
      const sql = local.tree.readContent(file);
      expect(sql).toContain(`export class MediaFiles${ts} implements MigrationInterface`);
      expect(sql).toMatch(/CONSTRAINT "PK_[0-9a-f]{27}" PRIMARY KEY \("id"\)/);
      expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "IDX_[0-9a-f]{26}" ON "media_files" \("deleted_at"\)/);
      expect(sql).toContain('ON "media_files" ("used", "created_at")');
      expect(sql).toContain('ON "media_files" ("owner_type", "owner_id")');
      expect(sql).toContain('"size" bigint NOT NULL');
      expect(sql).not.toContain('<%');
      const index = local.tree.readContent('/libs/database/src/migrations/index.ts');
      expect(index).toContain(`import { MediaFiles${ts} } from './${ts}-media-files';`);
      expect(index).toContain(`  MediaFiles${ts},\n  // @ns:migrations`);
    });

    it('adds the media core with the local driver only', () => {
      for (const f of ['index', 'media.module', 'media-files.service', 'media-usage.subscriber', 'file-signature', 'http-range', 'storage/local.storage']) {
        expect(local.tree.exists(`${MEDIA}/${f}.ts`)).withContext(f).toBeTrue();
      }
      expect(local.tree.exists(`${MEDIA}/storage/s3.storage.ts`)).toBeFalse();
      expect(local.tree.exists(`${MEDIA}/sharp-image.processor.ts`)).toBeFalse();
      const service = local.tree.readContent(`${MEDIA}/media-files.service.ts`);
      expect(service).toContain('async markUsed(ids: string[], owner: MediaOwner, manager?: EntityManager): Promise<void>');
      expect(service).toContain('async release(ids: string[], manager?: EntityManager): Promise<void>');
      expect(service).toContain('async findByIds(ids: string[]): Promise<MediaFile[]>');
      const module = local.tree.readContent(MEDIA_MODULE);
      expect(module).toContain('{ provide: LOCAL_STORAGE_DRIVER, useClass: LocalStorageDriver },');
      expect(module).not.toContain('S3_STORAGE_DRIVER');
      expect(module).toContain('exports: [MediaFilesService, MediaStorageService]');
      // Not in the @app/common barrel: apps that do not use uploads never load it.
      expect(local.tree.readContent('/libs/common/src/index.ts')).not.toContain('media');
    });

    it('registers the routes module, permissions and typed multipart routes', () => {
      const api = local.tree.readContent('/apps/api/src/api.module.ts');
      expect(api).toContain("import { MediaRoutesModule } from './modules/media/media-routes.module';");
      expect(api).toMatch(/imports: \[[\s\S]*MediaRoutesModule,?\s*\]/);
      expect(local.tree.readContent('/libs/common/src/permissions.ts')).toContain("{ resource: 'media_file', actions: ['read', 'write'] },");
      const admin = local.tree.readContent(`${ROUTES}/admin-media-files.controller.ts`);
      expect(admin).toContain("@AdminResource('files', { read: ['media_file.read'], write: ['media_file.write'] })");
      expect(admin).toContain("@ApiConsumes('multipart/form-data')");
      expect(admin).toContain('@ApiBody({ type: UploadFilesDto })');
      expect(admin).toContain("@UseInterceptors(FilesInterceptor('files'))");
      expect(admin).toContain('@ApiPaginatedResponse(MediaFileDto)');
      const dto = local.tree.readContent(`${ROUTES}/dto/media-file-query.dto.ts`);
      expect(dto).toContain("items: { type: 'string', format: 'binary' }");
      expect(dto).toContain("enumName: 'MediaUsage'");
      const pub = local.tree.readContent(`${ROUTES}/media-files.controller.ts`);
      expect(pub).toContain("@Controller('files')");
      expect(pub).toContain("@Get(':id/stream')");
      expect(pub).toContain('@ApiResponse({ status: 206');
      const routes = local.tree.readContent(ROUTES_MODULE);
      expect(routes).toContain('controllers: [AdminMediaFilesController, MediaFilesController]');
      expect(routes).toContain('dest: settings.tmpDir');
      expect(local.tree.exists(`${ROUTES}/client-media-files.controller.ts`)).toBeFalse();
    });

    it('adds optional env keys, @types/multer and ignores the upload folder', () => {
      const example = local.tree.readContent('/.env.example');
      expect(example).toContain('# ── Uploads (media_files)');
      for (const line of ['UPLOAD_STORAGE=', 'UPLOAD_DIR=./uploads', 'UPLOAD_MAX_IMAGE_MB=10', 'UPLOAD_MAX_VIDEO_MB=500', 'UPLOAD_ORPHAN_HOURS=24']) {
        expect(example).toContain(`\n${line}\n`);
      }
      expect(example).not.toContain('\nS3_BUCKET=');
      const validation = local.tree.readContent('/libs/common/src/config/env.validation.ts');
      expect(validation).toContain("@IsIn(['local', 's3', ''])\n  UPLOAD_STORAGE?: string;");
      expect(validation).toContain('@IsInt()\n  UPLOAD_ORPHAN_HOURS?: number;');
      const p = pkg(local.tree);
      expect(p.devDependencies['@types/multer']).toBeDefined();
      expect(p.dependencies['@aws-sdk/client-s3']).toBeUndefined();
      expect(p.dependencies['sharp']).toBeUndefined();
      expect(local.tree.readContent('/.gitignore')).toContain('\n/uploads\n');
      expect(local.tree.readContent('/docker-compose.yml')).not.toContain('minio');
    });

    it('records the feature and, without a worker, hints at the cleanup job', () => {
      expect(manifest(local.tree)['upload']).toEqual(
        jasmine.objectContaining({ options: { storage: 'local', thumbnails: false }, items: ['local'] }),
      );
      expect(local.tree.exists(JOB)).toBeFalse();
      expect(local.logs.some((l) => l.message.includes('npm run g -- worker'))).toBeTrue();
    });

    it('changes nothing on a second run', async () => {
      await expectIdempotent(runner, local.tree);
    });
  });

  describe('--storage s3', () => {
    let s3: RunResult;

    beforeAll(async () => {
      s3 = await run(runner, 'upload', { storage: 's3' }, starter);
    });

    it('adds the S3 driver, its provider, dependency, env and MinIO', () => {
      expect(s3.tree.readContent(`${MEDIA}/storage/s3.storage.ts`)).toContain('export class S3StorageDriver implements StorageDriver');
      const module = s3.tree.readContent(MEDIA_MODULE);
      expect(module).toContain('{ provide: S3_STORAGE_DRIVER, useClass: S3StorageDriver }');
      expect(module).toMatch(/import \{ LOCAL_STORAGE_DRIVER, S3_STORAGE_DRIVER \} from '.\/storage\/storage-driver';/);
      expect(module).toContain("import { S3StorageDriver } from './storage/s3.storage';");
      expect(pkg(s3.tree).dependencies['@aws-sdk/client-s3']).toBeDefined();
      const example = s3.tree.readContent('/.env.example');
      for (const key of ['S3_ENDPOINT=http://localhost:9000', 'S3_REGION=us-east-1', 'S3_BUCKET=uploads', 'S3_ACCESS_KEY=minioadmin', 'S3_FORCE_PATH_STYLE=true']) {
        expect(example).toContain(`\n${key}\n`);
      }
      expect(example).toContain('\nS3_SECRET_KEY=change-me-to-a-long-random-string\n');
      const compose = s3.tree.readContent('/docker-compose.yml');
      expect(compose).toContain('\n  minio:\n    image: minio/minio:latest');
      expect(compose).toContain('\n  minio-init:\n');
      expect(compose).toContain('  minio-data:');
      expect(manifest(s3.tree)['upload']).toEqual(
        jasmine.objectContaining({ options: { storage: 's3', thumbnails: false }, items: ['local', 's3'] }),
      );
    });

    it('keeps the S3 driver on a re-run without --storage and is idempotent', async () => {
      await expectIdempotent(runner, s3.tree);
    });

    it('adding s3 to a local install edits the existing module (no kept-file warning)', async () => {
      const upgraded = await run(runner, 'upload', { storage: 's3' }, local.tree);
      expect(upgraded.logs.filter((l) => l.level === 'warn')).toEqual([]);
      expect(upgraded.tree.readContent(MEDIA_MODULE)).toBe(s3.tree.readContent(MEDIA_MODULE));
      expect(upgraded.tree.readContent('/docker-compose.yml')).toBe(s3.tree.readContent('/docker-compose.yml'));
    });
  });

  describe('--thumbnails', () => {
    let thumbs: RunResult;

    beforeAll(async () => {
      thumbs = await run(runner, 'upload', { thumbnails: true }, starter);
    });

    it('adds the sharp processor, its provider, sharp and the width key', () => {
      expect(thumbs.tree.readContent(`${MEDIA}/sharp-image.processor.ts`)).toContain('.webp({ quality: 75 })');
      expect(thumbs.tree.readContent(MEDIA_MODULE)).toContain('{ provide: MEDIA_IMAGE_PROCESSOR, useClass: SharpImageProcessor }');
      expect(pkg(thumbs.tree).dependencies['sharp']).toBeDefined();
      expect(thumbs.tree.readContent('/.env.example')).toContain('\nUPLOAD_THUMBNAIL_WIDTH=320\n');
      expect(manifest(thumbs.tree)['upload'].options).toEqual({ storage: 'local', thumbnails: true });
    });

    it('stays on for re-runs without the flag', async () => {
      await expectIdempotent(runner, thumbs.tree);
    });
  });

  describe('client routes (auth-client)', () => {
    async function withClientAuth(tree: UnitTestTree): Promise<UnitTestTree> {
      const t = tree.branch() as UnitTestTree;
      t.create('/apps/api/src/client-auth/index.ts', CLIENT_AUTH_STUB);
      recordFeature(t, 'auth-client');
      return t;
    }

    it('are added when auth-client is installed first', async () => {
      const { tree } = await run(runner, 'upload', {}, await withClientAuth(starter));
      const controller = tree.readContent(`${ROUTES}/client-media-files.controller.ts`);
      expect(controller).toContain("import { CurrentUser, UserGuard, UserPrincipal } from '../../client-auth';");
      expect(controller).toContain("@Controller('client/files')");
      expect(controller).toContain('@UseGuards(UserGuard)');
      const routes = tree.readContent(ROUTES_MODULE);
      expect(routes).toContain('controllers: [AdminMediaFilesController, MediaFilesController, ClientMediaFilesController]');
      expect(routes).toContain("import { ClientMediaFilesController } from './client-media-files.controller';");
      await expectIdempotent(runner, tree);
    });

    it('are added by re-running upload after auth-client', async () => {
      const { tree, logs } = await run(runner, 'upload', {}, await withClientAuth(local.tree));
      expect(logs.filter((l) => l.level === 'warn')).toEqual([]);
      expect(tree.exists(`${ROUTES}/client-media-files.controller.ts`)).toBeTrue();
      expect(tree.readContent(ROUTES_MODULE)).toContain('ClientMediaFilesController]');
      await expectIdempotent(runner, tree);
    });
  });

  describe('with the worker', () => {
    let workerFirst: UnitTestTree;
    let uploadFirst: UnitTestTree;

    beforeAll(async () => {
      const w = await run(runner, 'worker', {}, starter);
      workerFirst = (await run(runner, 'upload', {}, w.tree)).tree;
      uploadFirst = (await run(runner, 'worker', {}, local.tree)).tree;
    });

    it('registers the hourly cleanup job (worker, then upload)', () => {
      expect(workerFirst.exists(JOB)).toBeTrue();
      const module = workerFirst.readContent(WORKER_MODULE);
      expect(module).toContain('    WorkerService,\n    MediaCleanupJob,\n    // @ns:worker-jobs');
      expect(module).toContain("import { MediaCleanupJob } from './jobs/media-cleanup.job';");
      expect(module).toContain("import { MediaModule } from '@app/common/media';");
      expect(module).toMatch(/DatabaseModule,\n\s+MediaModule,/);
      const job = workerFirst.readContent(JOB);
      expect(job).toContain("@Cron(CronExpression.EVERY_HOUR, { name: 'media-cleanup' })");
      expect(job).toContain('this.media.purgeOrphans()');
    });

    it('registers the same job when the worker comes second (upload, then worker)', () => {
      expect(uploadFirst.readContent(WORKER_MODULE)).toBe(workerFirst.readContent(WORKER_MODULE));
      expect(uploadFirst.readContent(JOB)).toBe(workerFirst.readContent(JOB));
    });

    it('is idempotent in both orders', async () => {
      for (const t of [workerFirst, uploadFirst]) {
        const before = snapshot(t);
        let again = (await run(runner, 'upload', {}, t)).tree;
        again = (await run(runner, 'worker', {}, again)).tree;
        expect(snapshot(again)).toEqual(before);
      }
    });
  });

  it('lets crud file(...) fields reference media_files', async () => {
    const { tree } = await run(runner, 'nest-crud', { name: 'banner', fields: 'title:string,image:file(image)?,docs:file(pdf)[]?' }, local.tree);
    const service = tree.readContent('/apps/api/src/modules/banner/banner.service.ts');
    expect(service).toContain("imageId: { target: MediaFile, where: { kind: 'image' } },");
    const sql = tree.files.filter((f) => f.endsWith('-create-banner.ts')).map((f) => tree.readContent(f))[0];
    expect(sql).toContain('REFERENCES "media_files"("id")');
  });

  it('fails outside a generated project', async () => {
    await expectAsync(runner.runSchematic('upload', { skipInstall: true }, new UnitTestTree(new HostTree()))).toBeRejected();
  });
});
