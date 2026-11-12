import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';

const API_MODULE = '/apps/api/src/api.module.ts';
const WORKER_MODULE = '/apps/worker/src/worker.module.ts';

describe('queue add-on', () => {
  const runner = createRunner();
  let tree: UnitTestTree;

  async function run(names: string[], start?: UnitTestTree): Promise<UnitTestTree> {
    let t = start ?? (await createStarterTree(runner));
    for (const name of names) t = await runner.runSchematic(name, { skipInstall: true }, t);
    return t;
  }

  beforeAll(async () => {
    tree = await run(['redis', 'queue']);
  });

  it('needs the redis add-on, with the command to run', async () => {
    await expectAsync(run(['queue'])).toBeRejectedWithError(/"queue" needs "redis" first:\n {2}npm run g -- redis/);
  });

  it('adds the queue library and the generic JobsService', () => {
    for (const f of ['queue.types', 'job-handler.decorator', 'jobs.service', 'queue.explorer', 'queue.module', 'index']) {
      expect(tree.exists(`/libs/common/src/queue/${f}.ts`)).withContext(f).toBeTrue();
    }
    expect(tree.readContent('/libs/common/src/index.ts')).toContain("export * from './queue';");
    const jobs = tree.readContent('/libs/common/src/queue/jobs.service.ts');
    expect(jobs).toContain('async enqueue<T>(name: string, data: T, opts: EnqueueOptions = {}): Promise<EnqueuedJob>');
    const types = tree.readContent('/libs/common/src/queue/queue.types.ts');
    expect(types).toContain("backoff: { type: 'exponential', delay: 1000 }");
    expect(types).toContain('attempts: 3');
  });

  it('runs the processors in the api without a worker, and adds GET admin/queues', () => {
    const api = tree.readContent(API_MODULE);
    expect(api).toContain('QueueModule.forRoot(),');
    expect(api).toContain("import { QueuesAdminModule } from './modules/queues/queues-admin.module';");
    expect(tree.readContent('/libs/common/src/permissions.ts')).toContain("{ resource: 'queue', actions: ['read', 'write'] },");
    const admin = tree.readContent('/apps/api/src/modules/queues/queues-admin.controller.ts');
    expect(admin).toContain("@AdminResource('queues', { read: ['queue.read'], write: ['queue.write'] })");
    // Reads need queue.read; retry, clean, pause and resume need queue.write.
    expect(admin).toContain("@AdminAccess('read')\n  @Get(':queue/jobs')");
    for (const route of [':queue/jobs/:id/retry', ':queue/clean', ':queue/pause', ':queue/resume']) {
      expect(admin).toContain(`@AdminAccess('write')\n  @HttpCode(HttpStatus.OK)\n  @Post('${route}')`);
    }
    expect(admin).toContain('export class CleanQueueDto');
    expect(admin).toContain("apiEnum(QueueJobStatus, 'QueueJobStatus')");
    const jobs = tree.readContent('/libs/common/src/queue/jobs.service.ts');
    for (const method of ['listJobs', 'retryJob', 'clean', 'pauseQueue', 'resumeQueue']) expect(jobs).toContain(`async ${method}(`);
    expect(tree.exists('/libs/common/src/queue/jobs.service.spec.ts')).toBeTrue();
    const pkg = JSON.parse(tree.readContent('/package.json')) as Record<string, Record<string, string>>;
    expect(pkg.dependencies['bullmq']).toBe('^5.81.0');
    expect(pkg.dependencies['@nestjs/bullmq']).toBe('^11.0.5');
  });

  it('is idempotent', async () => {
    const before = snapshot(tree);
    const again = await runner.runSchematic('queue', { skipInstall: true }, tree);
    expect(snapshot(again)).toEqual(before);
  });

  it('moves the processors to apps/worker in both install orders', async () => {
    const workerAfter = await run(['redis', 'queue', 'worker']);
    const workerFirst = await run(['redis', 'worker', 'queue']);
    for (const t of [workerAfter, workerFirst]) {
      const api = t.readContent(API_MODULE);
      expect(api).toContain('QueueModule.forRoot({ processors: false }),');
      expect(api).not.toContain('QueueModule.forRoot(),');
      expect(api.match(/QueueModule\.forRoot/g)!.length).toBe(1);
      const worker = t.readContent(WORKER_MODULE);
      expect(worker).toContain('QueueModule.forRoot(),');
      expect(worker).toMatch(/import \{[^}]*\bQueueModule\b[^}]*\} from '@app\/common';/);
    }
    expect(workerAfter.readContent(WORKER_MODULE)).toBe(workerFirst.readContent(WORKER_MODULE));
    // Re-running either add-on changes nothing.
    const before = snapshot(workerAfter);
    expect(snapshot(await run(['queue', 'worker'], workerAfter))).toEqual(before);
  });
});
