import {
  MergeStrategy,
  Rule,
  SchematicContext,
  SchematicsException,
  Tree,
  apply,
  applyTemplates,
  chain,
  mergeWith,
  move,
  noop,
  url,
} from '@angular-devkit/schematics';
import { dirname, join, normalize, strings } from '@angular-devkit/core';
import { posix } from 'path';
import { FieldSpecError, parseFields } from '../utils/fields';
import { addModuleImport } from '../utils/module-import';
import { renderFields } from './render';
import { Schema } from './schema';

const DEFAULT_FIELDS = 'name:string';

/** Relative import specifier from directory `from` to path `to` (always starts with `.`). */
function importPath(from: string, to: string): string {
  const rel = posix.relative(`/${normalize(from)}`, `/${normalize(to)}`);
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** `apps/<app>/src` passed by the Nest CLI (`nest g -c ... -p bot`) → `bot`. */
function appFromSourceRoot(sourceRoot: string | undefined): string | undefined {
  return sourceRoot ? /(?:^|\/)apps\/([^/]+)\/src\/?$/.exec(sourceRoot)?.[1] : undefined;
}

/** Appends `export * from './<file>';` to a barrel once. */
function addBarrelExport(tree: Tree, barrel: string, file: string): boolean {
  const line = `export * from './${file}';`;
  const current = tree.exists(barrel) ? tree.read(barrel)!.toString('utf-8') : '';
  if (current.split('\n').some((l) => l.trim() === line)) return false;
  const next = `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`;
  if (tree.exists(barrel)) tree.overwrite(barrel, next);
  else tree.create(barrel, next);
  return true;
}

export function nestCrud(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    if (!options.name || !options.name.trim()) {
      throw new SchematicsException('Resource name is required.');
    }
    const name = strings.dasherize(options.name.trim());
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new SchematicsException(
        `Invalid resource name "${options.name}". Use letters, digits and dashes (e.g. sp-year).`,
      );
    }

    const app = options.app || appFromSourceRoot(options.sourceRoot) || 'api';
    const appSrc = `apps/${app}/src`;
    const featureBase = options.path || `${appSrc}/modules`;
    const featureDir = normalize(`${featureBase}/${name}`);
    const dbLib = options.dbLib || 'libs/database/src';
    const entitiesDir = normalize(`${dbLib}/entities`);
    const modulePath = options.module || `${appSrc}/${app}.module.ts`;
    const authDir = `${appSrc}/auth`;

    let fields;
    try {
      fields = parseFields(options.fields && options.fields.trim() ? options.fields : DEFAULT_FIELDS);
    } catch (e) {
      if (e instanceof FieldSpecError) throw new SchematicsException(`--fields: ${e.message}`);
      throw e;
    }
    if (!fields.length) fields = parseFields(DEFAULT_FIELDS);

    if (!tree.exists(`${dbLib}/base.entity.ts`)) {
      context.logger.warn(
        `${dbLib}/base.entity.ts not found. The generated code expects the monorepo from ` +
          `"fuse-nest-schematics:starter" (libs/database, libs/common, @app/* paths).`,
      );
    }
    if (!tree.exists(`${authDir}/index.ts`)) {
      context.logger.warn(`${authDir}/index.ts not found — the controller imports AdminResource from it.`);
    }

    const rendered = renderFields(name, fields);
    context.logger.info(`Creating CRUD resource "${name}"`);
    context.logger.info(`  entity:  ${entitiesDir}/${name}.entity.ts`);
    context.logger.info(`  module:  ${featureDir}/`);
    context.logger.info(`  route:   admin/${name}`);
    context.logger.info(
      `  fields:  ${fields.map((f) => `${f.name}:${f.type}${f.nullable ? '?' : ''}`).join(', ')}`,
    );

    const templateOptions = {
      ...strings,
      name,
      ...rendered,
      allFieldNames: ['id', ...fields.map((f) => f.name), 'createdAt', 'updatedAt'],
      hasOptionalProps: fields.some((f) => f.nullable),
      hasOptionalDtoProps: fields.some((f) => f.nullable || f.type === 'boolean'),
      authPath: importPath(featureDir, authDir),
    };

    const entitySource = apply(url('./files/entity'), [
      applyTemplates(templateOptions),
      move(entitiesDir),
    ]);
    const featureSource = apply(url('./files/feature'), [
      applyTemplates(templateOptions),
      move(normalize(featureBase)),
    ]);

    const exportEntity: Rule = (host: Tree) => {
      addBarrelExport(host, `${entitiesDir}/index.ts`, `${name}.entity`);
      return host;
    };

    const registerModule: Rule = (host: Tree) => {
      if (!host.exists(modulePath)) {
        context.logger.warn(`${modulePath} not found — register ${strings.classify(name)}Module manually.`);
        return host;
      }
      const added = addModuleImport(
        host,
        modulePath,
        `${strings.classify(name)}Module`,
        importPath(dirname(normalize(modulePath)), join(featureDir, `${name}.module`)),
      );
      context.logger.info(
        added
          ? `Registered ${strings.classify(name)}Module in ${modulePath}`
          : `${strings.classify(name)}Module is already registered in ${modulePath}`,
      );
      return host;
    };

    return chain([
      mergeWith(entitySource, MergeStrategy.Overwrite),
      mergeWith(featureSource, MergeStrategy.Overwrite),
      exportEntity,
      options.skipImport ? noop() : registerModule,
    ])(tree, context);
  };
}
