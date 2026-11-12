import {
  Rule,
  SchematicContext,
  SchematicsException,
  Tree,
  apply,
  applyTemplates,
  chain,
  move,
  noop,
  url,
} from '@angular-devkit/schematics';
import { dirname, join, normalize, strings } from '@angular-devkit/core';
import { FieldSpec, FieldSpecError, parseFields, stringifyField } from '../utils/fields';
import {
  PERMISSIONS_FILE,
  addBarrelExport,
  addMigration,
  addModuleImport,
  addPermissions,
  addSeed,
  hasFeature,
  importPath,
  mergeSafe,
  readText,
  recordFeature,
  writeText,
} from '../utils/ops';
import { findMigration, latestTimestamp, renderMigration } from './migration';
import { TargetInfo, buildModel, pickLabel } from './model';
import { snake } from './naming';
import { renderFields } from './render';
import { MAX_SEED_ROWS, renderSeed } from './seed';
import { Schema } from './schema';

const DEFAULT_FIELDS = 'name:string';
const DEFAULT_DB_LIB = 'libs/database/src';
export const MEDIA_FILE = { className: 'MediaFile', file: 'media-file' };

/** `apps/<app>/src` passed by the Nest CLI (`nest g -c ... -p bot`) → `bot`. */
function appFromSourceRoot(sourceRoot: string | undefined): string | undefined {
  return sourceRoot ? /(?:^|\/)apps\/([^/]+)\/src\/?$/.exec(sourceRoot)?.[1] : undefined;
}

/** Property names declared in an entity file (`  name: string;`, `  category?: ...`). */
function entityProperties(source: string): string[] {
  const props = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt']);
  for (const match of source.matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*)[?!]?\s*:\s*[^\n]*;\s*$/gm)) props.add(match[1]);
  return [...props];
}

/** Table name from `@Entity({ name: 'x' })` / `@Entity('x')`, else the snake-cased class. */
function entityTable(source: string, className: string): string {
  const match = /@Entity\(\s*(?:\{[^}]*?name:\s*)?['"]([^'"]+)['"]/.exec(source);
  return match ? match[1] : snake(className);
}

function resolveTargets(
  tree: Tree,
  name: string,
  fields: FieldSpec[],
  entitiesDir: string,
): Record<string, TargetInfo> {
  const className = strings.classify(name);
  const targets: Record<string, TargetInfo> = {};

  for (const f of fields) {
    if (f.type === 'relation') {
      const target = f.target!;
      let info = targets[target];
      if (!info) {
        if (target === className) {
          const properties = ['id', ...fields.map((x) => x.name)];
          info = { className, file: name, table: strings.underscore(name), label: pickLabel(properties), properties, route: `/admin/${name}` };
        } else {
          const file = strings.dasherize(target);
          const path = `${entitiesDir}/${file}.entity.ts`;
          if (!tree.exists(path)) {
            throw new SchematicsException(
              `--fields: ${f.name}:relation(${target}) needs the ${target} entity, but ${path} does not exist.\n` +
                `Generate it first, e.g.:\n  npm run g -- crud ${file} --fields "name:string"`,
            );
          }
          const source = readText(tree, path);
          if (!new RegExp(`export class ${target}\\b`).test(source)) {
            throw new SchematicsException(`--fields: ${path} does not export a class named ${target}.`);
          }
          const properties = entityProperties(source);
          info = {
            className: target,
            file,
            table: entityTable(source, target),
            label: pickLabel(properties),
            properties,
            route: `/admin/${file}`,
          };
        }
        targets[target] = info;
      }
      if (f.label && !info.properties.includes(f.label)) {
        throw new SchematicsException(
          `--fields: ${f.name}: label(${f.label}) is not a property of ${target} (has: ${info.properties.join(', ')}).`,
        );
      }
    }

    if (f.type === 'file' && !targets[MEDIA_FILE.className]) {
      if (!hasFeature(tree, 'upload')) {
        throw new SchematicsException(
          `--fields: ${f.name}:file(${f.kind}) stores files in the media_files table of the "upload" add-on, ` +
            `which is not installed. Run first:\n  npm run g -- upload`,
        );
      }
      const path = `${entitiesDir}/${MEDIA_FILE.file}.entity.ts`;
      if (!tree.exists(path)) {
        throw new SchematicsException(`--fields: ${f.name}:file(...) needs ${path} (from "npm run g -- upload").`);
      }
      const source = readText(tree, path);
      const properties = entityProperties(source);
      targets[MEDIA_FILE.className] = {
        ...MEDIA_FILE,
        table: entityTable(source, MEDIA_FILE.className),
        label: 'id',
        properties,
        route: '/files',
      };
    }
  }
  return targets;
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
    const dbLib = (options.dbLib || DEFAULT_DB_LIB).replace(/\/$/, '');
    const entitiesDir = normalize(`${dbLib}/entities`);
    const entityPath = `${entitiesDir}/${name}.entity.ts`;
    const modulePath = options.module || `${appSrc}/${app}.module.ts`;
    const authDir = `${appSrc}/auth`;

    let fields: FieldSpec[];
    try {
      fields = parseFields(options.fields && options.fields.trim() ? options.fields : DEFAULT_FIELDS);
    } catch (e) {
      if (e instanceof FieldSpecError) throw new SchematicsException(`--fields: ${e.message}`);
      throw e;
    }
    if (!fields.length) fields = parseFields(DEFAULT_FIELDS);

    const seed = options.seed;
    if (seed !== undefined && seed !== null && (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED_ROWS)) {
      throw new SchematicsException(`--seed must be an integer between 1 and ${MAX_SEED_ROWS}.`);
    }

    if (!tree.exists(`${dbLib}/base.entity.ts`)) {
      context.logger.warn(
        `${dbLib}/base.entity.ts not found. The generated code expects the monorepo from ` +
          `"npx nest-schematics new" (libs/database, libs/common, @app/* paths).`,
      );
    }
    if (!tree.exists(`${authDir}/index.ts`)) {
      context.logger.warn(`${authDir}/index.ts not found — the controller imports AdminResource from it.`);
    }

    const targets = resolveTargets(tree, name, fields, entitiesDir);
    const model = buildModel(name, fields, targets);
    const rendered = renderFields(model);
    const entityExisted = tree.exists(entityPath);

    context.logger.info(`Creating CRUD resource "${name}"`);
    context.logger.info(`  entity:  ${entityPath}`);
    context.logger.info(`  module:  ${featureDir}/`);
    context.logger.info(`  route:   admin/${name} (+ /options)`);
    context.logger.info(`  fields:  ${fields.map(stringifyField).join(', ')}`);

    const templateOptions = {
      ...strings,
      name,
      ...rendered,
      authPath: importPath(featureDir, authDir),
    };

    const entitySource = apply(url('./files/entity'), [applyTemplates(templateOptions), move(entitiesDir)]);
    const featureSource = apply(url('./files/feature'), [applyTemplates(templateOptions), move(normalize(featureBase))]);

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

    const changeHint =
      `Changing the fields of an existing table is not generated: edit the entity, then run\n` +
      `  npm run migration:generate --name=<change>`;

    const migration: Rule = (host: Tree) => {
      if (options.migration === false) return host;
      const migrationsDir = `${dbLib}/migrations`;
      const index = `${migrationsDir}/index.ts`;
      if (!host.exists(index)) {
        context.logger.warn(`${index} not found — no migration generated for "${name}".`);
        return host;
      }
      const files = host.getDir(migrationsDir).subfiles.map(String);
      const existing = findMigration(files, name);
      if (existing) {
        const again = renderMigration(model, existing.timestamp);
        const path = `${migrationsDir}/${existing.file}`;
        if (readText(host, path) !== again.content) {
          context.logger.warn(`Fields differ from the existing migration ${path} (left unchanged).\n${changeHint}`);
        }
        if (dbLib === DEFAULT_DB_LIB) addMigration(host, again.className, `${migrationsDir}/${existing.file.replace(/\.ts$/, '')}`);
        return host;
      }
      if (entityExisted) {
        context.logger.warn(
          `${entityPath} already existed, so no CREATE TABLE migration was generated for "${name}".\n${changeHint}`,
        );
        return host;
      }
      const timestamp = Math.max(Date.now(), latestTimestamp(files) + 1);
      const file = renderMigration(model, timestamp);
      const path = `${migrationsDir}/${file.file.split('/').pop()}`;
      host.create(`${path}.ts`, file.content);
      if (dbLib === DEFAULT_DB_LIB) addMigration(host, file.className, path);
      else context.logger.warn(`Register ${file.className} in ${index} manually.`);
      context.logger.info(`Migration: ${path}.ts`);
      return host;
    };

    const permissions: Rule = (host: Tree) => {
      if (!host.exists(PERMISSIONS_FILE)) {
        context.logger.warn(`${PERMISSIONS_FILE} not found — add "${name}.read" / "${name}.write" to your permission list.`);
        return host;
      }
      addPermissions(host, name, ['read', 'write']);
      return host;
    };

    const seeds: Rule = (host: Tree) => {
      if (!seed) return host;
      const index = `${dbLib}/seeds/index.ts`;
      if (!host.exists(index)) {
        context.logger.warn(`${index} not found — no seed generated for "${name}".`);
        return host;
      }
      const file = renderSeed(model, seed);
      const path = `${dbLib}/seeds/${name}.seed.ts`;
      if (host.exists(path) && readText(host, path) !== file.content && !options.force) {
        context.logger.warn(`Kept ${path}, which differs from the template (use --force to overwrite).`);
      } else {
        writeText(host, path, file.content);
      }
      if (dbLib === DEFAULT_DB_LIB) addSeed(host, file.exportName, file.file);
      else context.logger.warn(`Register ${file.exportName} in ${index} manually.`);
      return host;
    };

    const record: Rule = (host: Tree) => {
      recordFeature(host, 'crud', {}, name);
      return host;
    };

    return chain([
      mergeSafe(entitySource, options.force),
      mergeSafe(featureSource, options.force),
      exportEntity,
      options.skipImport ? noop() : registerModule,
      migration,
      permissions,
      seeds,
      record,
    ])(tree, context);
  };
}
