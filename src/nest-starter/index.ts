import {
  Rule,
  SchematicContext,
  SchematicsException,
  Tree,
  apply,
  applyTemplates,
  chain,
  filter,
  forEach,
  mergeWith,
  move,
  url,
} from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';
import { normalize, strings } from '@angular-devkit/core';
import { Schema } from './schema';

export const KNOWN_APPS = ['api', 'bot', 'worker'] as const;

/** `--apps "api,bot"` → ['api', 'bot']; api is always included and first. */
export function parseApps(spec: string | undefined): string[] {
  const requested = (spec ?? KNOWN_APPS.join(','))
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  const unknown = requested.filter((a) => !(KNOWN_APPS as readonly string[]).includes(a));
  if (unknown.length) {
    throw new SchematicsException(
      `Unknown app(s): ${unknown.join(', ')}. Allowed: ${KNOWN_APPS.join(', ')}.`,
    );
  }
  return KNOWN_APPS.filter((a) => a === 'api' || requested.includes(a));
}

export function nestStarter(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    if (!options.name || options.name.trim().length === 0) {
      throw new SchematicsException('Project name is required.');
    }

    const projectName = strings.dasherize(options.name.trim());
    const targetPath = options.directory
      ? normalize(`${options.directory}/${projectName}`)
      : normalize(projectName);

    if (tree.getDir(targetPath).subfiles.length || tree.getDir(targetPath).subdirs.length) {
      throw new SchematicsException(
        `Directory "${targetPath}" already exists. Please choose a different name.`,
      );
    }

    const apps = parseApps(options.apps);

    context.logger.info(`Creating NestJS monorepo "${projectName}"...`);
    context.logger.info(`Location: ${targetPath}`);
    context.logger.info(`Apps: ${apps.join(', ')} | Libs: common, database`);

    // npm strips `.gitignore` when publishing, so the template keeps it as
    // `gitignore` and it is renamed here.
    const templateSource = apply(url('./files'), [
      filter((path) => {
        const app = /^\/apps\/([^/]+)\//.exec(path)?.[1];
        return !app || apps.includes(app);
      }),
      applyTemplates({ ...strings, name: projectName, apps }),
      forEach((entry) => {
        if (/(^|\/)gitignore$/.test(entry.path)) {
          return {
            path: normalize(entry.path.replace(/gitignore$/, '.gitignore')),
            content: entry.content,
          };
        }
        return entry;
      }),
      move(targetPath),
    ]);

    if (!options.skipInstall) {
      context.addTask(new NodePackageInstallTask({ workingDirectory: targetPath }));
    }

    return chain([
      mergeWith(templateSource),
      (_tree: Tree, ctx: SchematicContext) => {
        ctx.logger.info('');
        ctx.logger.info('Next steps:');
        ctx.logger.info(`  cd ${targetPath}`);
        ctx.logger.info('  cp .env.example .env');
        if (options.skipInstall) ctx.logger.info('  npm install');
        ctx.logger.info('  npm run start:dev            # apps/api');
        for (const app of apps.filter((a) => a !== 'api')) {
          ctx.logger.info(`  npm run start:dev:${app}`);
        }
        ctx.logger.info(`  npx schematics fuse-nest-schematics:crud product --fields "name:string,price:number"`);
      },
    ])(tree, context);
  };
}
