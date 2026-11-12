import {
  Rule,
  SchematicContext,
  SchematicsException,
  Tree,
  apply,
  applyTemplates,
  chain,
  forEach,
  mergeWith,
  move,
  schematic,
  url,
} from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';
import { normalize, strings } from '@angular-devkit/core';
import { PACKAGE_VERSION } from '../utils/ops';
import { Schema } from './schema';

export const KNOWN_APPS = ['api', 'bot', 'worker'] as const;

/**
 * `--apps "api,bot"` → ['api', 'bot']; api is always included and first.
 * Default: api only. bot and worker are add-ons (`npm run g -- bot|worker`);
 * `--apps` runs those add-ons right after the starter.
 */
export function parseApps(spec: string | undefined): string[] {
  const requested = (spec ?? 'api')
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
    // `gitignore` and it is renamed here. The starter itself only has apps/api;
    // other apps come from their add-ons below.
    const templateSource = apply(url('./files'), [
      applyTemplates({ ...strings, name: projectName, apps: ['api'], version: PACKAGE_VERSION }),
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
      // Same code path as `npm run g -- <app>` inside the project.
      ...apps
        .filter((app) => app !== 'api')
        .map((app) => schematic(app, { root: targetPath, skipInstall: true })),
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
        ctx.logger.info(`  npm run g -- crud product --fields "name:string,price:number"`);
      },
    ])(tree, context);
  };
}
