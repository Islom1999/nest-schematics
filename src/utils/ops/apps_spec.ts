import { HostTree, Tree } from '@angular-devkit/schematics';
import { addNestApp, addNestAssets, addWorkerJob, hasWorker, insertAtMarker, MARKERS, WORKER_MODULE } from './index';

function read(tree: Tree, p: string): string {
  return tree.read(p)!.toString('utf-8');
}

const CLI = {
  monorepo: true,
  projects: {
    api: { type: 'application', root: 'apps/api' },
    common: { type: 'library', root: 'libs/common' },
  },
};

const WORKER = `import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { WorkerService } from './worker.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
  ],
  providers: [
    WorkerService,
    // @ns:worker-jobs
  ],
})
export class WorkerModule {}
`;

describe('ops/apps', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = new HostTree();
    tree.create('/nest-cli.json', JSON.stringify(CLI));
    tree.create('/package.json', JSON.stringify({ scripts: { build: 'nest build api', 'start:dev:api': 'x' } }));
  });

  it('adds a Nest app (cli project before the libraries, scripts, aggregate build) once', () => {
    expect(addNestApp(tree, 'worker')).toEqual({ cli: true, build: true, buildCustomised: false });
    expect(addNestApp(tree, 'worker')).toEqual({ cli: false, build: false, buildCustomised: false });
    addNestApp(tree, 'bot');
    const cli = JSON.parse(read(tree, '/nest-cli.json'));
    expect(Object.keys(cli.projects)).toEqual(['api', 'worker', 'bot', 'common']);
    expect(cli.projects.worker).toEqual({
      type: 'application',
      root: 'apps/worker',
      entryFile: 'main',
      sourceRoot: 'apps/worker/src',
      compilerOptions: { tsConfigPath: 'apps/worker/tsconfig.app.json' },
    });
    const pkg = JSON.parse(read(tree, '/package.json'));
    expect(pkg.scripts.build).toBe('nest build api && nest build worker && nest build bot');
    expect(pkg.scripts['build:worker']).toBe('nest build worker');
    expect(pkg.scripts['start:dev:worker']).toBe('nest start worker --watch');
    expect(pkg.scripts['start:prod:bot']).toBe('node dist/apps/bot/main');
  });

  it('adds a nest-cli asset to an app once', () => {
    const asset = { include: 'modules/ai/chat/prompts/*.md', watchAssets: true };
    expect(addNestAssets(tree, 'api', asset)).toBeTrue();
    expect(addNestAssets(tree, 'api', { include: 'modules/ai/chat/prompts/*.md' })).toBeFalse();
    expect(addNestAssets(tree, 'api', { include: 'mail/*.hbs' })).toBeTrue();
    const cli = JSON.parse(read(tree, '/nest-cli.json'));
    expect(cli.projects.api.compilerOptions.assets).toEqual([asset, { include: 'mail/*.hbs' }]);
    expect(cli.projects.common.compilerOptions).toBeUndefined();
    expect(() => addNestAssets(tree, 'nope', asset)).toThrowError(/no "nope" project/);
  });

  it('leaves a customised build script alone', () => {
    tree.overwrite('/package.json', JSON.stringify({ scripts: { build: 'turbo run build' } }));
    expect(addNestApp(tree, 'worker').buildCustomised).toBeTrue();
    expect(JSON.parse(read(tree, '/package.json')).scripts.build).toBe('turbo run build');
  });

  it('registers worker jobs at the marker, with their module imports, once', () => {
    expect(hasWorker(tree)).toBeFalse();
    expect(() => addWorkerJob(tree, 'FooJob', './jobs/foo.job')).toThrowError(/npm run g -- worker/);
    tree.create(`/${WORKER_MODULE}`, WORKER);
    expect(hasWorker(tree)).toBeTrue();
    const imports = [{ className: 'ApiLogModule', from: '@app/common' }];
    expect(addWorkerJob(tree, 'FooJob', './jobs/foo.job', { imports })).toBeTrue();
    expect(addWorkerJob(tree, 'FooJob', './jobs/foo.job', { imports })).toBeFalse();
    addWorkerJob(tree, 'BarJob', '@app/common');
    const text = read(tree, `/${WORKER_MODULE}`);
    expect(text).toContain('    WorkerService,\n    FooJob,\n    BarJob,\n    // @ns:worker-jobs\n');
    expect(text).toContain(`import { FooJob } from './jobs/foo.job';`);
    expect(text).toContain(`import { ApiLogModule, BarJob } from '@app/common';`);
    expect(text).toContain('    ScheduleModule.forRoot(),\n    ApiLogModule,\n');
    expect(text.match(/FooJob/g)!.length).toBe(2);
  });
});

describe('markers with a trailing note', () => {
  it('finds `// @ns:env (add-ons insert ...)`', () => {
    const tree = new HostTree();
    tree.create('/env.ts', 'class Env {\n  A: string;\n  // @ns:env (add-ons insert their keys above this line)\n}\n');
    expect(insertAtMarker(tree, '/env.ts', MARKERS.env, 'B?: string;')).toBeTrue();
    expect(read(tree, '/env.ts')).toContain('  B?: string;\n  // @ns:env (add-ons');
    tree.create('/other.ts', '// @ns:envelope\n');
    expect(() => insertAtMarker(tree, '/other.ts', MARKERS.env, 'x')).toThrowError(/not found/);
  });
});
