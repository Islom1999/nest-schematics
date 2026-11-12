import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';

describe('worker add-on', () => {
  const runner = createRunner();
  let tree: UnitTestTree;

  beforeAll(async () => {
    tree = await runner.runSchematic('worker', { skipInstall: true }, await createStarterTree(runner));
  });

  it('creates apps/worker with the heartbeat job and the jobs marker', () => {
    for (const file of ['tsconfig.app.json', 'src/main.ts', 'src/worker.module.ts', 'src/worker.service.ts']) {
      expect(tree.exists(`/apps/worker/${file}`)).withContext(file).toBeTrue();
    }
    const module = tree.readContent('/apps/worker/src/worker.module.ts');
    expect(module).toContain('ScheduleModule.forRoot()');
    expect(module).toContain('    WorkerService,\n    // @ns:worker-jobs\n');
    expect(tree.readContent('/apps/worker/src/worker.service.ts')).toContain("@Cron(CronExpression.EVERY_HOUR, { name: 'heartbeat' })");
  });

  it('declares the app, scripts and dependency, and records the feature', () => {
    const cli = JSON.parse(tree.readContent('/nest-cli.json'));
    expect(Object.keys(cli.projects)).toEqual(['api', 'worker', 'common', 'database']);
    const pkg = JSON.parse(tree.readContent('/package.json'));
    expect(pkg.scripts.build).toBe('nest build api && nest build worker');
    expect(pkg.scripts['start:dev:worker']).toBe('nest start worker --watch');
    expect(pkg.scripts['start:prod:worker']).toBe('node dist/apps/worker/main');
    expect(pkg.dependencies['@nestjs/schedule']).toBe('^6.0.0');
    expect(Object.keys(JSON.parse(tree.readContent('/nest-schematics.json')).features)).toEqual(['worker']);
  });

  it('changes nothing on a second run and keeps user edits', async () => {
    const copy = tree.branch();
    const edited = tree.readContent('/apps/worker/src/worker.service.ts').replace('EVERY_HOUR', 'EVERY_MINUTE');
    copy.overwrite('/apps/worker/src/worker.service.ts', edited);
    const before = snapshot(copy);
    const again = await runner.runSchematic('worker', { skipInstall: true }, copy);
    expect(snapshot(again)).toEqual(before);
  });

  it('schedules npm install unless --skip-install', async () => {
    const r = createRunner();
    await r.runSchematic('worker', {}, await createStarterTree(r));
    expect(r.tasks.some((t) => t.name === 'node-package')).toBeTrue();
  });

  it('fails outside a generated project', async () => {
    const { HostTree } = await import('@angular-devkit/schematics');
    await expectAsync(runner.runSchematic('worker', { skipInstall: true }, new HostTree())).toBeRejectedWithError(
      /nest-schematics new/,
    );
  });
});
