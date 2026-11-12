import { logging } from '@angular-devkit/core';
import { HostTree } from '@angular-devkit/schematics';
import { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import { recordFeature } from '../../utils/ops';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';

const TUS = '/apps/api/src/modules/tus';
const TUS_MODULE = `${TUS}/tus.module.ts`;
const LIB = '/libs/common/src/media/tus';
const JOB = '/apps/worker/src/jobs/tus-cleanup.job.ts';
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

function manifest(tree: UnitTestTree) {
  return JSON.parse(tree.readContent('/nest-schematics.json')).features as Record<string, { options?: Record<string, unknown>; items?: string[] }>;
}

function pkg(tree: UnitTestTree) {
  return JSON.parse(tree.readContent('/package.json')) as { dependencies: Record<string, string> };
}

async function expectIdempotent(runner: SchematicTestRunner, tree: UnitTestTree, options: Record<string, unknown> = {}) {
  const before = snapshot(tree);
  const again = await run(runner, 'upload-tus', options, tree);
  expect(snapshot(again.tree)).toEqual(before);
  expect(again.logs.filter((l) => l.level === 'warn').map((l) => l.message)).toEqual([]);
}

describe('upload-tus add-on', () => {
  const runner = createRunner();
  let starter: UnitTestTree;
  let withUpload: UnitTestTree;
  let tusd: RunResult;
  let node: RunResult;

  beforeAll(async () => {
    starter = await createStarterTree(runner);
    withUpload = (await run(runner, 'upload', {}, starter)).tree;
    tusd = await run(runner, 'upload-tus', {}, withUpload);
    node = await run(runner, 'upload-tus', { engine: 'node' }, withUpload);
  });

  it('requires the upload add-on', async () => {
    await expectAsync(runner.runSchematic('upload-tus', { skipInstall: true }, starter.branch() as UnitTestTree)).toBeRejectedWithError(
      /"upload-tus" needs "upload" first:\n {2}npm run g -- upload/,
    );
  });

  it('fails outside a generated project', async () => {
    await expectAsync(runner.runSchematic('upload-tus', { skipInstall: true }, new UnitTestTree(new HostTree()))).toBeRejectedWithError(
      /nest-schematics new/,
    );
  });

  describe('shared core', () => {
    it('adds the tus lib (limits, folder rules) and the module with the result route', () => {
      for (const f of ['index', 'tus.settings', 'tus-limits', 'tus-files', 'tus.spec']) {
        expect(tusd.tree.exists(`${LIB}/${f}.ts`)).withContext(f).toBeTrue();
      }
      expect(tusd.tree.readContent(`${LIB}/tus-limits.ts`)).toContain('export function checkTusCreate(settings: MediaSettings, input: TusCreateInput)');
      const api = tusd.tree.readContent('/apps/api/src/api.module.ts');
      expect(api).toContain("import { TusModule } from './modules/tus/tus.module';");
      expect(api).toMatch(/imports: \[[\s\S]*MediaRoutesModule,[\s\S]*TusModule,?\s*\]/);
      const controller = tusd.tree.readContent(`${TUS}/tus-uploads.controller.ts`);
      expect(controller).toContain("@Controller('files/tus')");
      expect(controller).toContain("@Get(':uploadId/result')");
      expect(controller).toContain('@ApiOkResponse({ type: TusUploadResultDto })');
      expect(tusd.tree.readContent(`${TUS}/dto/tus-upload-result.dto.ts`)).toContain("apiEnum(TusUploadStatus, 'TusUploadStatus')");
      const service = tusd.tree.readContent(`${TUS}/tus-uploads.service.ts`);
      expect(service).toContain('this.media.upload(');
      expect(tusd.tree.exists(`${TUS}/tus-auth.service.spec.ts`)).toBeTrue();
    });

    it('adds optional env keys and hints at the worker', () => {
      const example = tusd.tree.readContent('/.env.example');
      expect(example).toContain('# ── Resumable uploads (tus)');
      expect(example).toMatch(/^TUS_DIR=$/m);
      expect(example).toMatch(/^TUS_EXPIRE_HOURS=24$/m);
      const validation = tusd.tree.readContent('/libs/common/src/config/env.validation.ts');
      expect(validation).toContain('TUS_EXPIRE_HOURS?: number;');
      expect(validation).toContain('TUS_DIR?: string;');
      expect(tusd.logs.some((l) => l.message.includes('npm run g -- worker'))).toBeTrue();
    });

    it('accepts admin tokens only without auth-client (no user verifier)', () => {
      expect(tusd.tree.exists(`${TUS}/tus-user-auth.ts`)).toBeFalse();
      const auth = tusd.tree.readContent(`${TUS}/tus-auth.service.ts`);
      expect(auth).toContain("export const TUS_ADMIN_PERMISSIONS = ['media_file.write'];");
      expect(auth).toContain('@Optional() @Inject(TUS_USER_AUTH)');
      expect(tusd.tree.readContent(TUS_MODULE)).not.toContain('useClass: TusUserAuth');
    });
  });

  describe('--engine tusd (default)', () => {
    it('adds the hook controller and service to TusModule', () => {
      const module = tusd.tree.readContent(TUS_MODULE);
      expect(module).toContain('controllers: [TusUploadsController, TusHooksController]');
      expect(module).toContain('providers: [TusAuthService, TusUploadsService, TusHooksService]');
      const controller = tusd.tree.readContent(`${TUS}/tus-hooks.controller.ts`);
      expect(controller).toContain("@Controller('internal/tus-hooks')");
      for (const d of ['@ApiExcludeController()', '@Public()', '@SkipThrottle()', '@HttpCode(200)']) expect(controller).toContain(d);
      const service = tusd.tree.readContent(`${TUS}/tus-hooks.service.ts`);
      expect(service).toContain('timingSafeEqual');
      expect(service).toContain("case 'pre-create':");
      expect(service).toContain("case 'post-finish':");
      expect(service).toContain('ChangeFileInfo');
      expect(tusd.tree.exists(`${TUS}/tus-hooks.controller.spec.ts`)).toBeTrue();
      expect(tusd.tree.exists(`${TUS}/tus-node.server.ts`)).toBeFalse();
      expect(pkg(tusd.tree).dependencies['@tus/server']).toBeUndefined();
    });

    it('adds a pinned tusd service sharing a volume with the api', () => {
      const compose = tusd.tree.readContent('/docker-compose.yml');
      expect(compose).toContain('  tusd:\n    image: tusproject/tusd:v2.10.1\n');
      expect(compose).toContain('      - -hooks-http=http://api:3000/api/internal/tus-hooks\n');
      expect(compose).toContain('      - -hooks-http-forward-headers=X-Tus-Hook-Secret\n');
      expect(compose).toContain('      - -behind-proxy\n');
      expect(compose).toContain('      - -hooks-enabled-events=pre-create,post-finish\n');
      expect(compose).toContain('      - tus-data:/srv/tusd-data\n');
      expect(compose).toMatch(/\n {2}tus-data:\n {2}# @ns:volumes/);
      expect(compose).toMatch(/ {2}api:\n[\s\S]*?\n {6}TUS_DIR: \/srv\/tusd-data\n[\s\S]*?\n {6}tusd:\n {8}condition: service_started\n {4}volumes:\n {6}- tus-data:\/srv\/tusd-data\n/);
      expect(tusd.tree.readContent('/.env.example')).toMatch(/^TUS_HOOK_SECRET=$/m);
    });

    it('records the feature and changes nothing on a second run', async () => {
      expect(manifest(tusd.tree)['upload-tus']).toEqual(jasmine.objectContaining({ options: { engine: 'tusd' }, items: ['tusd'] }));
      await expectIdempotent(runner, tusd.tree);
    });
  });

  describe('--engine node', () => {
    it('adds the in-process tus server, its routes and the @tus packages', () => {
      const module = node.tree.readContent(TUS_MODULE);
      expect(module).toContain('controllers: [TusUploadsController, TusNodeController]');
      expect(module).toContain('providers: [TusAuthService, TusUploadsService, TusNodeServer]');
      const server = node.tree.readContent(`${TUS}/tus-node.server.ts`);
      expect(server).toContain("await import('@tus/server')");
      expect(server).toContain("import type { Server, Upload } from '@tus/server';");
      expect(server).toContain('onUploadCreate: (req, upload) => this.onCreate(req, upload)');
      expect(server).toContain('[TUS_MEDIA_ID_HEADER]: file.id');
      const controller = node.tree.readContent(`${TUS}/tus-node.controller.ts`);
      expect(controller).toContain("@Controller('files/tus')");
      expect(controller).toContain("@Patch(':uploadId')");
      expect(controller).toContain('@ApiExcludeController()');
      const deps = pkg(node.tree).dependencies;
      expect(deps['@tus/server']).toBe('^2.4.7');
      expect(deps['@tus/file-store']).toBe('^2.1.2');
      expect(node.tree.readContent('/docker-compose.yml')).not.toContain('tusd');
      expect(node.tree.exists(`${TUS}/tus-hooks.controller.ts`)).toBeFalse();
      expect(node.tree.readContent('/.env.example')).not.toContain('TUS_HOOK_SECRET');
    });

    it('stays node on a re-run without --engine and is idempotent', async () => {
      expect(manifest(node.tree)['upload-tus']).toEqual(jasmine.objectContaining({ options: { engine: 'node' }, items: ['node'] }));
      await expectIdempotent(runner, node.tree);
    });

    it('adding the other engine keeps both', async () => {
      const both = (await run(runner, 'upload-tus', { engine: 'tusd' }, node.tree)).tree;
      const module = both.readContent(TUS_MODULE);
      expect(module).toContain('controllers: [TusUploadsController, TusNodeController, TusHooksController]');
      expect(manifest(both)['upload-tus'].items).toEqual(['node', 'tusd']);
      await expectIdempotent(runner, both);
    });
  });

  describe('user tokens (auth-client)', () => {
    let clientFirst: UnitTestTree;

    beforeAll(async () => {
      const t = withUpload.branch() as UnitTestTree;
      t.create('/apps/api/src/client-auth/index.ts', CLIENT_AUTH_STUB);
      recordFeature(t, 'auth-client');
      clientFirst = (await run(runner, 'upload-tus', { engine: 'node' }, t)).tree;
    });

    it('registers the UserGuard-based verifier when auth-client is installed first', () => {
      const verifier = clientFirst.readContent(`${TUS}/tus-user-auth.ts`);
      expect(verifier).toContain("import { UserGuard, UserPrincipal } from '../../client-auth';");
      expect(verifier).toContain('export class TusUserAuth implements TusUserAuthenticator');
      const module = clientFirst.readContent(TUS_MODULE);
      expect(module).toContain('{ provide: TUS_USER_AUTH, useClass: TusUserAuth }');
      expect(module).toContain("import { TusAuthService, TUS_USER_AUTH } from './tus-auth.service';");
      expect(module).toContain("import { TusUserAuth } from './tus-user-auth';");
    });

    it('is added by re-running upload-tus after auth-client, idempotently', async () => {
      const t = node.tree.branch() as UnitTestTree;
      t.create('/apps/api/src/client-auth/index.ts', CLIENT_AUTH_STUB);
      recordFeature(t, 'auth-client');
      const after = (await run(runner, 'upload-tus', {}, t)).tree;
      expect(after.readContent(TUS_MODULE)).toBe(clientFirst.readContent(TUS_MODULE));
      expect(after.readContent(`${TUS}/tus-user-auth.ts`)).toBe(clientFirst.readContent(`${TUS}/tus-user-auth.ts`));
      await expectIdempotent(runner, after);
    });
  });

  describe('with the worker', () => {
    let workerFirst: UnitTestTree;
    let tusFirst: UnitTestTree;

    beforeAll(async () => {
      const w = await run(runner, 'worker', {}, withUpload);
      workerFirst = (await run(runner, 'upload-tus', {}, w.tree)).tree;
      tusFirst = (await run(runner, 'worker', {}, tusd.tree)).tree;
    });

    it('registers the hourly cleanup job (worker, then upload-tus)', () => {
      expect(workerFirst.exists(JOB)).toBeTrue();
      const module = workerFirst.readContent(WORKER_MODULE);
      expect(module).toContain("import { TusCleanupJob } from './jobs/tus-cleanup.job';");
      expect(module).toMatch(/MediaCleanupJob,\n {4}TusCleanupJob,\n {4}\/\/ @ns:worker-jobs/);
      const job = workerFirst.readContent(JOB);
      expect(job).toContain("@Cron(CronExpression.EVERY_HOUR, { name: 'tus-cleanup' })");
      expect(job).toContain("import { purgeExpiredTusUploads, readTusSettings } from '@app/common/media/tus';");
    });

    it('registers the same job when the worker comes second (upload-tus, then worker)', () => {
      expect(tusFirst.readContent(WORKER_MODULE)).toBe(workerFirst.readContent(WORKER_MODULE));
      expect(tusFirst.readContent(JOB)).toBe(workerFirst.readContent(JOB));
    });

    it('is idempotent in both orders', async () => {
      for (const t of [workerFirst, tusFirst]) {
        const before = snapshot(t);
        let again = (await run(runner, 'upload-tus', {}, t)).tree;
        again = (await run(runner, 'worker', {}, again)).tree;
        expect(snapshot(again)).toEqual(before);
      }
    });
  });
});
