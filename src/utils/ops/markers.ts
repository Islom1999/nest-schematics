import { SchematicsException, Tree } from '@angular-devkit/schematics';
import { readText, writeText } from './text';

/**
 * Starter files carry marker comments where add-ons insert code, e.g.
 * `// @ns:bootstrap` in main.ts. The marker line stays; code goes right above
 * it with the marker's indentation.
 */
export const MARKERS = {
  /** apps/api/src/main.ts, after global pipes/filters, before Swagger. */
  bootstrap: '// @ns:bootstrap',
  /** apps/api/src/main.ts, after `listen()`. */
  afterListen: '// @ns:after-listen',
  /** libs/common/src/config/env.validation.ts, last line inside the class. */
  env: '// @ns:env',
  /** libs/database/src/migrations/index.ts, inside the array. */
  migrations: '// @ns:migrations',
  /** libs/database/src/seeds/index.ts, inside the array. */
  seeds: '// @ns:seeds',
  /** libs/common/src/permissions.ts, inside PERMISSION_CATALOG. */
  permissions: '// @ns:permissions',
  /** apps/api/src/config/swagger.ts, route prefixes of the admin document. */
  swaggerAdmin: '// @ns:swagger-admin',
  /** apps/api/src/config/swagger.ts, route prefixes of the client document. */
  swaggerClient: '// @ns:swagger-client',
  /** docker-compose.yml, end of `services:`. */
  composeServices: '# @ns:services',
  /** docker-compose.yml, end of `volumes:`. */
  composeVolumes: '# @ns:volumes',
  /** docker-compose.yml, end of the `api` service `environment:`. */
  composeApiEnvironment: '# @ns:api-environment',
  /** apps/api/src/health/health.controller.ts, last constructor parameter (inject indicators). */
  healthInject: '// @ns:health-inject',
  /** apps/api/src/health/health.controller.ts, checks of `GET /health`. */
  healthCheck: '// @ns:health-check',
  /** apps/api/src/health/health.controller.ts, checks of `GET /health/ready`. */
  healthReady: '// @ns:health-ready',
} as const;

/**
 * Inserts `code` above `marker` in `path`. `key` (default: the code itself)
 * must not be present in the file yet, otherwise nothing happens.
 *
 * @returns false when the code was already there.
 */
export function insertAtMarker(tree: Tree, path: string, marker: string, code: string, key = code.trim()): boolean {
  const text = readText(tree, path);
  const lines = text.split('\n');
  const index = lines.findIndex((l) => isMarkerLine(l, marker));
  if (index < 0) {
    throw new SchematicsException(
      `Marker "${marker}" not found in ${path}. Restore it, or add this code manually:\n${code}`,
    );
  }
  if (dedent(text).includes(dedent(key))) return false;
  const indent = /^[ \t]*/.exec(lines[index])![0];
  const block = code
    .replace(/\n+$/, '')
    .split('\n')
    .map((l) => (l ? `${indent}${l}` : l));
  lines.splice(index, 0, ...block);
  writeText(tree, path, lines.join('\n'));
  return true;
}

/** `// @ns:env` also matches `// @ns:env (add-ons insert their keys above this line)`. */
function isMarkerLine(line: string, marker: string): boolean {
  const text = line.trim();
  return text === marker || text.startsWith(`${marker} `);
}

/** Strips each line's indentation so a check does not depend on where the code sits. */
function dedent(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
}

export function hasMarker(tree: Tree, path: string, marker: string): boolean {
  return tree.exists(path) && readText(tree, path).split('\n').some((l) => isMarkerLine(l, marker));
}
