import {
  Rule,
  SchematicContext,
  SchematicsException,
  Tree,
  apply,
  applyTemplates,
  chain,
  move,
  url,
} from '@angular-devkit/schematics';
import { strings } from '@angular-devkit/core';
import { addSeed, getProject, mergeSafe, recordFeature } from '../../utils/ops';
import { Schema } from './schema';

/**
 * `npm run g -- seed <name> [--dev-only]`: creates
 * libs/database/src/seeds/<name>.seed.ts and registers it in seeds/index.ts,
 * so `npm run seed` (all) and `npm run seed -- <name>` run it.
 */
export function seed(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const project = getProject(tree);
    const name = strings.dasherize((options.name ?? '').trim());
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new SchematicsException(
        `Invalid seed name "${options.name ?? ''}". Use letters, digits and dashes (e.g. demo-products).`,
      );
    }
    const seedsDir = `${project.databaseSrc}/seeds`;
    const exportName = `${strings.camelize(name)}Seeder`;

    const source = apply(url('./files'), [
      applyTemplates({ ...strings, name, devOnly: !!options.devOnly }),
      move(seedsDir),
    ]);

    return chain([
      mergeSafe(source, options.force),
      (host: Tree) => {
        const added = addSeed(host, exportName, `libs/database/src/seeds/${name}.seed`, project.root);
        context.logger.info(
          added ? `Registered ${exportName} in ${seedsDir}/index.ts` : `${exportName} is already registered`,
        );
        recordFeature(host, 'seed', {}, name, project.root);
        context.logger.info(`Run it: npm run seed -- ${name}`);
      },
    ])(tree, context);
  };
}
