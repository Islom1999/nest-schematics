import { SchematicsException, Tree } from '@angular-devkit/schematics';
import { addNamedImports } from './ast';
import { hasMarker, insertAtMarker } from './markers';
import { addModuleImport } from './module';
import { addPackageJson } from './package-json';
import { readText, writeText } from './text';

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

export interface AddNestAppResult {
  /** The project was added to nest-cli.json. */
  cli: boolean;
  /** `nest build <app>` was appended to the aggregate `build` script. */
  build: boolean;
  /** The aggregate `build` script was customised, so it was left alone. */
  buildCustomised: boolean;
}

/**
 * Declares `apps/<app>` as a Nest monorepo application: the nest-cli.json
 * project, `build:<app>` / `start:dev:<app>` / `start:prod:<app>` scripts and
 * `nest build <app>` in the aggregate `build` script. Idempotent; existing
 * entries and user-edited scripts are left alone.
 */
export function addNestApp(tree: Tree, app: string, root = ''): AddNestAppResult {
  const result: AddNestAppResult = { cli: false, build: false, buildCustomised: false };

  const cliPath = prefixed(root, 'nest-cli.json');
  const cli = JSON.parse(readText(tree, cliPath));
  const projects: Record<string, { type?: string }> = cli.projects ?? {};
  if (!projects[app]) {
    const entry = {
      type: 'application',
      root: `apps/${app}`,
      entryFile: 'main',
      sourceRoot: `apps/${app}/src`,
      compilerOptions: { tsConfigPath: `apps/${app}/tsconfig.app.json` },
    };
    // Applications first, then libraries, as in the starter.
    const entries = Object.entries(projects);
    const firstLib = entries.findIndex(([, p]) => p.type === 'library');
    entries.splice(firstLib < 0 ? entries.length : firstLib, 0, [app, entry]);
    cli.projects = Object.fromEntries(entries);
    writeText(tree, cliPath, `${JSON.stringify(cli, null, 2)}\n`);
    result.cli = true;
  }

  addPackageJson(
    tree,
    {
      scripts: {
        [`build:${app}`]: `nest build ${app}`,
        [`start:dev:${app}`]: `nest start ${app} --watch`,
        [`start:prod:${app}`]: `node dist/apps/${app}/main`,
      },
    },
    root,
  );

  const pkgPath = prefixed(root, 'package.json');
  const pkg = JSON.parse(readText(tree, pkgPath));
  const build: string | undefined = pkg.scripts?.build;
  const builds = build?.split('&&').map((s) => s.trim()) ?? [];
  if (!builds.includes(`nest build ${app}`)) {
    if (build && builds.every((s) => /^nest build [\w-]+$/.test(s))) {
      pkg.scripts.build = [...builds, `nest build ${app}`].join(' && ');
      writeText(tree, pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      result.build = true;
    } else if (build) {
      result.buildCustomised = true;
    } else {
      pkg.scripts = { ...pkg.scripts, build: `nest build ${app}` };
      writeText(tree, pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      result.build = true;
    }
  }
  return result;
}

export interface NestAsset {
  /** Glob relative to the app's sourceRoot, e.g. `modules/ai/chat/prompts/*.md`. */
  include: string;
  exclude?: string;
  outDir?: string;
  watchAssets?: boolean;
}

/**
 * Adds a non-TypeScript file pattern to `projects.<app>.compilerOptions.assets`
 * in nest-cli.json, so `nest build <app>` copies it next to the compiled app
 * (the webpack bundle does not include `.md`, `.hbs`, ... files). Idempotent:
 * an asset with the same `include` is left alone.
 *
 * @returns false when the asset was already there.
 */
export function addNestAssets(tree: Tree, app: string, asset: NestAsset, root = ''): boolean {
  const cliPath = prefixed(root, 'nest-cli.json');
  const cli = JSON.parse(readText(tree, cliPath));
  const project = cli.projects?.[app];
  if (!project) throw new SchematicsException(`nest-cli.json has no "${app}" project.`);
  const options = (project.compilerOptions ??= {});
  const assets: (string | NestAsset)[] = (options.assets ??= []);
  if (assets.some((a) => (typeof a === 'string' ? a : a.include) === asset.include)) return false;
  assets.push(asset);
  writeText(tree, cliPath, `${JSON.stringify(cli, null, 2)}\n`);
  return true;
}

/** apps/worker/src/worker.module.ts: where cron job classes are registered. */
export const WORKER_MODULE = 'apps/worker/src/worker.module.ts';

/**
 * Marker inside `providers: [...]` of WorkerModule. Every add-on registers its
 * `@Cron` job classes above it with {@link addWorkerJob}.
 */
export const WORKER_JOBS_MARKER = '// @ns:worker-jobs';

/** True when the project has the worker app with the jobs marker (`npm run g -- worker`). */
export function hasWorker(tree: Tree, root = ''): boolean {
  return hasMarker(tree, prefixed(root, WORKER_MODULE), WORKER_JOBS_MARKER);
}

export interface WorkerJobOptions {
  /** Modules the job needs in WorkerModule `imports`, e.g. `{ className: 'ApiLogModule', from: '@app/common' }`. */
  imports?: { className: string; from: string; expression?: string }[];
}

/**
 * Registers a cron job provider in WorkerModule. `from` is the import
 * specifier as written in worker.module.ts (`./jobs/foo.job` or `@app/common`).
 * Note: `TypeOrmModule.forFeature([...])` entries count as one import, so jobs
 * should import a feature module (or use DataSource) rather than forFeature.
 *
 * @returns false when the job was already registered.
 * @throws when the worker app or its marker is missing (check {@link hasWorker}).
 */
export function addWorkerJob(
  tree: Tree,
  className: string,
  from: string,
  options: WorkerJobOptions = {},
  root = '',
): boolean {
  const path = prefixed(root, WORKER_MODULE);
  if (!tree.exists(path)) {
    throw new SchematicsException(`${WORKER_MODULE} not found. Add the worker first: npm run g -- worker`);
  }
  for (const imp of options.imports ?? []) {
    addModuleImport(tree, path, imp.className, imp.from, imp.expression);
  }
  const added = insertAtMarker(tree, path, WORKER_JOBS_MARKER, `${className},`, `${className},`);
  addNamedImports(tree, path, [{ name: className, from }]);
  return added;
}

/**
 * Undoes {@link addWorkerJob}: removes the provider and its import from
 * WorkerModule. Modules added with the job stay (they may serve other jobs).
 *
 * @returns false when the job was not registered.
 */
export function removeWorkerJob(tree: Tree, className: string, root = ''): boolean {
  const path = prefixed(root, WORKER_MODULE);
  if (!tree.exists(path)) return false;
  const text = readText(tree, path);
  const provider = new RegExp(`^[ \\t]*${className},[ \\t]*\\r?\\n`, 'm');
  if (!provider.test(text)) return false;
  const next = text
    .replace(provider, '')
    // `import { Job } from '...';` on its own, or `Job` among other named imports
    .replace(new RegExp(`^import \\{ ${className} \\} from '[^']+';\\r?\\n`, 'm'), '')
    .replace(new RegExp(`^(import \\{[^}\\n]*?)(?:, ${className}\\b|\\b${className}, )`, 'm'), '$1');
  writeText(tree, path, next);
  return true;
}
