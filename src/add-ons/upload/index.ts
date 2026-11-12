import {
  Rule,
  SchematicContext,
  Source,
  Tree,
  apply,
  applyTemplates,
  chain,
  filter,
  move,
  noop,
  url,
} from '@angular-devkit/schematics';
import { createHash } from 'crypto';
import {
  addBarrelExport,
  addComposeService,
  addEnv,
  addIgnoreEntries,
  addMigration,
  addModuleController,
  addModuleImport,
  addModuleProvider,
  addPackageJson,
  addPermissions,
  getProject,
  hasFeature,
  mergeSafe,
  readManifest,
  recordFeature,
  scheduleInstall,
} from '../../utils/ops';
import { MEDIA_MODULE_FILE, registerMediaCleanup } from './cleanup';
import { Schema } from './schema';

const MIGRATIONS_DIR = 'libs/database/src/migrations';
const MIGRATION_RE = /^(\d{13})-media-files\.ts$/;
const ROUTES_MODULE_FILE = 'apps/api/src/modules/media/media-routes.module.ts';
/** Created once, then only edited through ops (drivers, thumbnails, client routes are added to them). */
const CREATE_ONLY = [MEDIA_MODULE_FILE, ROUTES_MODULE_FILE];

/** Feature whose installation adds the `client/files` routes (contract: apps/api/src/client-auth/index.ts). */
export const CLIENT_AUTH_FEATURE = 'auth-client';

type StorageName = 'local' | 's3';

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

/** TypeORM's DefaultNamingStrategy names, so `migration:generate` sees no difference. */
function typeormName(prefix: 'PK_' | 'IDX_', table: string, columns: string[]): string {
  const key = `${table}_${[...columns].sort().join('_')}`;
  return prefix + createHash('sha1').update(key).digest('hex').slice(0, prefix === 'PK_' ? 27 : 26);
}

/** Reuses the timestamp of an existing migration so re-runs change nothing. */
function migrationTimestamp(tree: Tree, root: string): string {
  for (const file of tree.getDir(prefixed(root, MIGRATIONS_DIR)).subfiles) {
    const match = MIGRATION_RE.exec(file);
    if (match) return match[1];
  }
  return String(Date.now());
}

const MINIO_SERVICE = `image: minio/minio:latest
restart: unless-stopped
command: server /data --console-address ":9001"
environment:
  MINIO_ROOT_USER: \${S3_ACCESS_KEY:-minioadmin}
  MINIO_ROOT_PASSWORD: \${S3_SECRET_KEY:-minioadmin}
ports:
  - "9000:9000"
  - "9001:9001"
volumes:
  - minio-data:/data
healthcheck:
  test: ["CMD", "mc", "ready", "local"]
  interval: 5s
  timeout: 5s
  retries: 10`;

const MINIO_INIT_SERVICE = `image: minio/mc:latest
depends_on:
  minio:
    condition: service_healthy
environment:
  S3_ACCESS_KEY: \${S3_ACCESS_KEY:-minioadmin}
  S3_SECRET_KEY: \${S3_SECRET_KEY:-minioadmin}
  S3_BUCKET: \${S3_BUCKET:-uploads}
entrypoint: ["/bin/sh", "-c", "mc alias set local http://minio:9000 \\"$$S3_ACCESS_KEY\\" \\"$$S3_SECRET_KEY\\" && mc mb --ignore-existing \\"local/$$S3_BUCKET\\""]
restart: "no"`;

/**
 * `npm run g -- upload [--storage local|s3] [--thumbnails]`: `media_files`
 * entity + migration, the media core in libs/common/src/media
 * (`@app/common/media`: MediaModule, MediaFilesService, storage drivers),
 * routes in apps/api/src/modules/media (admin/files, public files/:id,
 * client/files with auth-client) and, with the worker, an hourly orphan
 * cleanup. Re-run it to add the S3 driver, thumbnails or client routes.
 */
export function upload(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const root = options.root ?? '';
    const project = getProject(tree, root);
    const previous = readManifest(tree, root)?.features['upload'];
    const previousOptions = previous?.options ?? {};
    const storage: StorageName = options.storage ?? (previousOptions['storage'] === 's3' ? 's3' : 'local');
    const drivers = new Set<StorageName>(['local', storage]);
    if (previous?.items?.includes('s3')) drivers.add('s3');
    const s3 = drivers.has('s3');
    const thumbnails = options.thumbnails === true || previousOptions['thumbnails'] === true;
    const client = hasFeature(tree, CLIENT_AUTH_FEATURE, root);
    const timestamp = migrationTimestamp(tree, root);

    const mediaModule = prefixed(root, MEDIA_MODULE_FILE);
    const routesModule = prefixed(root, ROUTES_MODULE_FILE);
    const source = (dir: string, templates: Record<string, unknown> = {}): Source =>
      apply(url(dir), [
        filter((path) => !CREATE_ONLY.some((f) => path === `/${f}` && tree.exists(prefixed(root, f)))),
        applyTemplates(templates),
        root ? move(root) : noop(),
      ]);

    const files = source('./files/core', {
      timestamp,
      primaryKey: typeormName('PK_', 'media_files', ['id']),
      deletedAtIndex: typeormName('IDX_', 'media_files', ['deleted_at']),
    });

    const wire: Rule = (host: Tree) => {
      addBarrelExport(host, `${project.entitiesDir}/index.ts`, 'media-file.entity');
      addMigration(host, `MediaFiles${timestamp}`, `${MIGRATIONS_DIR}/${timestamp}-media-files`, root);
      addPermissions(host, 'media_file', ['read', 'write'], root);
      addModuleImport(host, project.apiModule, 'MediaRoutesModule', './modules/media/media-routes.module');
      addPackageJson(host, { devDependencies: { '@types/multer': '^2.0.0' } }, root);
      addIgnoreEntries(host, '.gitignore', 'uploads (UPLOAD_DIR)', ['/uploads'], root);
      addIgnoreEntries(host, '.dockerignore', 'uploads (UPLOAD_DIR)', ['uploads'], root);

      addEnv(
        host,
        {
          title: 'Uploads (media_files)',
          vars: [
            {
              key: 'UPLOAD_STORAGE',
              value: '',
              type: 'enum',
              values: ['local', 's3', ''],
              comment: 'local | s3; empty = s3 when the S3 driver is installed and S3_BUCKET is set, else local',
            },
            { key: 'UPLOAD_DIR', value: './uploads', comment: 'Local driver root (keep it out of git; mount a volume in containers)' },
            { key: 'UPLOAD_TMP_DIR', value: '', comment: 'Incoming files before they are checked (default: UPLOAD_DIR/.tmp)' },
            { key: 'UPLOAD_PUBLIC_URL', value: '', comment: 'Base of file URLs in responses (default /api/files), e.g. https://api.example.com/api/files' },
            { key: 'UPLOAD_MAX_FILES', value: '10', type: 'number', comment: 'Files per upload request' },
            { key: 'UPLOAD_MAX_IMAGE_MB', value: '10', type: 'number', comment: 'Per-kind size limits in MB' },
            { key: 'UPLOAD_MAX_VIDEO_MB', value: '500', type: 'number' },
            { key: 'UPLOAD_MAX_AUDIO_MB', value: '50', type: 'number' },
            { key: 'UPLOAD_MAX_PDF_MB', value: '20', type: 'number' },
            { key: 'UPLOAD_MAX_OTHER_MB', value: '20', type: 'number' },
            {
              key: 'UPLOAD_ALLOWED_KINDS',
              value: 'image,video,audio,pdf,other',
              comment: 'Accepted kinds (types are detected from the content; text, HTML and SVG are never accepted)',
            },
            { key: 'UPLOAD_ORPHAN_HOURS', value: '24', type: 'number', comment: 'The worker deletes files still unused after this many hours; 0 = never' },
            { key: 'UPLOAD_CACHE_MAX_AGE', value: '604800', type: 'number', comment: 'Cache-Control max-age (seconds) of GET files/:id' },
          ],
        },
        root,
      );

      if (s3) {
        addModuleProvider(host, mediaModule, {
          expression: '{ provide: S3_STORAGE_DRIVER, useClass: S3StorageDriver }',
          imports: [
            { name: 'S3_STORAGE_DRIVER', from: './storage/storage-driver' },
            { name: 'S3StorageDriver', from: './storage/s3.storage' },
          ],
        });
        addPackageJson(host, { dependencies: { '@aws-sdk/client-s3': '^3.700.0' } }, root);
        addEnv(
          host,
          {
            title: 'S3 storage (uploads)',
            vars: [
              { key: 'S3_ENDPOINT', value: 'http://localhost:9000', comment: 'Empty for AWS S3; MinIO from docker-compose: http://localhost:9000' },
              { key: 'S3_REGION', value: 'us-east-1' },
              { key: 'S3_BUCKET', value: 'uploads', comment: 'Empty = uploads stay on the local driver' },
              { key: 'S3_ACCESS_KEY', value: 'minioadmin', comment: 'Empty = AWS default credential chain (IAM role)' },
              { key: 'S3_SECRET_KEY', secret: true },
              { key: 'S3_FORCE_PATH_STYLE', value: 'true', type: 'boolean', comment: 'true for MinIO' },
              { key: 'S3_PUBLIC_URL', value: '', comment: 'Optional public base URL of the bucket or CDN; files are then linked directly' },
            ],
          },
          root,
        );
        addComposeService(host, 'minio', MINIO_SERVICE, ['minio-data'], root);
        addComposeService(host, 'minio-init', MINIO_INIT_SERVICE, [], root);
      }

      if (thumbnails) {
        addModuleProvider(host, mediaModule, {
          expression: '{ provide: MEDIA_IMAGE_PROCESSOR, useClass: SharpImageProcessor }',
          imports: [
            { name: 'MEDIA_IMAGE_PROCESSOR', from: './image-processor' },
            { name: 'SharpImageProcessor', from: './sharp-image.processor' },
          ],
        });
        addPackageJson(host, { dependencies: { sharp: '^0.34.0' } }, root);
        addEnv(
          host,
          {
            title: 'Uploads (media_files)',
            vars: [{ key: 'UPLOAD_THUMBNAIL_WIDTH', value: '320', type: 'number', comment: 'Thumbnail box in pixels (webp)' }],
          },
          root,
        );
      }

      if (client) {
        addModuleController(host, routesModule, {
          expression: 'ClientMediaFilesController',
          imports: [{ name: 'ClientMediaFilesController', from: './client-media-files.controller' }],
        });
      }

      registerMediaCleanup(host, context.logger, root);
      recordFeature(host, 'upload', { storage, thumbnails }, 'local', root);
      if (s3) recordFeature(host, 'upload', {}, 's3', root);
      scheduleInstall(context, options.skipInstall, root);
      return host;
    };

    return chain([
      mergeSafe(files, options.force),
      s3 ? mergeSafe(source('./files/s3'), options.force) : noop(),
      thumbnails ? mergeSafe(source('./files/thumbnails'), options.force) : noop(),
      client ? mergeSafe(source('./files/client'), options.force) : noop(),
      wire,
      (_host: Tree, ctx: SchematicContext) => {
        ctx.logger.info(
          `Uploads: run "npm run migration:run" (${MIGRATIONS_DIR}/${timestamp}-media-files.ts). Routes: ` +
            'POST /api/admin/files/upload, GET /api/admin/files (permissions media_file.read / media_file.write), ' +
            `public GET /api/files/:id (+ /stream, /thumbnail)${client ? ', /api/client/files' : ''}. ` +
            `Storage: ${[...drivers].join(', ')}${s3 ? ' (docker compose up -d minio minio-init)' : ''}.`,
        );
        if (!client) {
          ctx.logger.info(`Client upload routes are added when you re-run "npm run g -- upload" after "${CLIENT_AUTH_FEATURE}".`);
        }
        if (options.storage === 'local' && s3) {
          ctx.logger.warn('The S3 driver stays installed: set UPLOAD_STORAGE=local in .env to store new uploads locally.');
        }
      },
    ]);
  };
}
