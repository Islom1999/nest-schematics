import { Rule, SchematicContext, SchematicsException, Tree } from '@angular-devkit/schematics';
import { strings } from '@angular-devkit/core';
import { posix } from 'path';
import { addPackageJson, getProject, readText, recordFeature, scheduleInstall, writeText } from '../../utils/ops';
import { OpenapiGenerator, Schema } from './schema';

/** openapi-generator (Java) version the project pins in openapitools.json. */
export const OPENAPI_GENERATOR_VERSION = '7.26.0';
export const OPENAPI_GENERATOR_CLI = '@openapitools/openapi-generator-cli';
export const OPENAPI_GENERATOR_CLI_VERSION = '^2.41.0';
export const OPENAPITOOLS_FILE = 'openapitools.json';

const GENERATORS: OpenapiGenerator[] = ['typescript-angular', 'dart-dio', 'typescript-fetch'];

export interface GeneratorTarget {
  generatorName: OpenapiGenerator;
  inputSpec: string;
  output: string;
  additionalProperties: Record<string, string | boolean>;
}

interface OpenapiToolsJson {
  $schema?: string;
  spaces?: number;
  'generator-cli': {
    version: string;
    generators?: Record<string, GeneratorTarget>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Per-generator settings for clients that match the API (string enums, typed services). */
export function additionalProperties(
  generator: OpenapiGenerator,
  ctx: { pubName: string; description: string },
): Record<string, string | boolean> {
  switch (generator) {
    case 'typescript-angular':
      // No npmName: the client is a folder inside the Angular app, not a package.
      return { ngVersion: '20.0.0', providedIn: 'root', stringEnums: true, withInterfaces: true };
    case 'dart-dio':
      return { pubName: ctx.pubName, pubVersion: '1.0.0', pubDescription: ctx.description };
    case 'typescript-fetch':
      return { supportsES6: true, stringEnums: true, withInterfaces: true };
  }
}

/** Document names declared in apps/api/src/config/swagger.ts (`name: 'admin'`). */
function declaredDocuments(tree: Tree, apiSrc: string): string[] | null {
  const path = `${apiSrc}/config/swagger.ts`;
  if (!tree.exists(path)) return null;
  const text = readText(tree, path);
  const block = /SWAGGER_DOCUMENTS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(text)?.[1] ?? text;
  const names: string[] = [];
  const pattern = /^\s*name:\s*'([^']+)'/gm;
  for (let m = pattern.exec(block); m; m = pattern.exec(block)) names.push(m[1]);
  return names;
}

function sameTarget(a: GeneratorTarget, b: GeneratorTarget): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `npm run g -- openapi-client --name admin --doc admin --generator typescript-angular --target ../shop-admin/src/app/core/api`
 *
 * Adds one openapi-generator target to openapitools.json and the scripts
 * `api:generate:<name>` (export + that client) and `api:generate` (export + all
 * clients). Re-running with the same options changes nothing; another name adds
 * another target.
 */
export function openapiClient(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const project = getProject(tree);
    const prefix = project.root ? `${project.root}/` : '';

    const name = strings.dasherize((options.name ?? '').trim());
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new SchematicsException(`Invalid --name "${options.name ?? ''}". Use letters, digits and dashes (e.g. admin, web, mobile).`);
    }
    const generator = options.generator ?? 'typescript-angular';
    if (!GENERATORS.includes(generator)) {
      throw new SchematicsException(`Unknown --generator "${generator}". Allowed: ${GENERATORS.join(', ')}.`);
    }
    const target = posix.normalize((options.target ?? '').trim().replace(/\\/g, '/')).replace(/\/+$/, '');
    if (!target || target === '.') {
      throw new SchematicsException('--target is required: the output folder, e.g. ../shop-admin/src/app/core/api.');
    }
    const doc = (options.doc ?? (name === 'admin' ? 'admin' : 'client')).trim();
    const documents = declaredDocuments(tree, project.apiSrc);
    if (documents && documents.length && !documents.includes(doc)) {
      throw new SchematicsException(`Unknown --doc "${doc}". Documents in apps/api/src/config/swagger.ts: ${documents.join(', ')}.`);
    }

    const pkg = JSON.parse(readText(tree, `${prefix}package.json`));
    if (!pkg.scripts?.['swagger:export']) {
      throw new SchematicsException(
        'package.json has no "swagger:export" script. Projects from nest-schematics >= 0.2 have it; ' +
          'add apps/api/src/config/swagger-export.ts from a new project first.',
      );
    }
    const pubName = options.pubName ?? `${strings.underscore(pkg.name ?? 'app')}_${strings.underscore(name)}_api`;
    if (generator === 'dart-dio' && !/^[a-z][a-z0-9_]*$/.test(pubName)) {
      throw new SchematicsException(`Invalid --pub-name "${pubName}". Dart package names are lower_snake_case.`);
    }

    const entry: GeneratorTarget = {
      generatorName: generator,
      inputSpec: `openapi/${doc}.json`,
      output: target,
      additionalProperties: additionalProperties(generator, {
        pubName,
        description: `${pkg.name ?? 'API'} ${doc} API client`,
      }),
    };

    const configPath = `${prefix}${OPENAPITOOLS_FILE}`;
    const config: OpenapiToolsJson = tree.exists(configPath)
      ? JSON.parse(readText(tree, configPath))
      : {
          $schema: './node_modules/@openapitools/openapi-generator-cli/config.schema.json',
          spaces: 2,
          'generator-cli': { version: OPENAPI_GENERATOR_VERSION },
        };
    const cli = (config['generator-cli'] ??= { version: OPENAPI_GENERATOR_VERSION });
    cli.version ??= OPENAPI_GENERATOR_VERSION;
    const generators = (cli.generators ??= {});
    const existing = generators[name];
    if (existing && !sameTarget(existing, entry) && !options.force) {
      context.logger.warn(
        `Target "${name}" already exists in ${OPENAPITOOLS_FILE} with other settings; kept it (use --force to replace).`,
      );
    } else {
      generators[name] = entry;
    }
    cli.generators = Object.fromEntries(Object.entries(generators).sort(([a], [b]) => a.localeCompare(b)));
    writeText(tree, configPath, `${JSON.stringify(config, null, 2)}\n`);

    addPackageJson(
      tree,
      {
        devDependencies: { [OPENAPI_GENERATOR_CLI]: OPENAPI_GENERATOR_CLI_VERSION },
        scripts: {
          [`api:generate:${name}`]: `npm run swagger:export && openapi-generator-cli generate --generator-key ${name}`,
          // Without --generator-key the CLI runs every target in openapitools.json.
          'api:generate': 'npm run swagger:export && openapi-generator-cli generate',
        },
      },
      project.root,
    );

    recordFeature(tree, 'openapi-client', {}, name, project.root);
    scheduleInstall(context, options.skipInstall, project.root);

    context.logger.info(
      `OpenAPI client "${name}": ${generator} from openapi/${doc}.json → ${target}\n` +
        `  npm run api:generate:${name}   # export the spec, then generate (needs Java 11+, or set "useDocker": true in ${OPENAPITOOLS_FILE})`,
    );
    return tree;
  };
}
