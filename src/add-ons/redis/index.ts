import { Rule, SchematicContext, Tree, apply, chain, move, noop, url } from '@angular-devkit/schematics';
import {
  addBarrelExport,
  addComposeService,
  addEnv,
  addModuleImport,
  addNamedImports,
  addPackageJson,
  getProject,
  hasMarker,
  insertAtMarker,
  MARKERS,
  mergeSafe,
  readText,
  recordFeature,
  scheduleInstall,
} from '../../utils/ops';
import { Schema } from './schema';

/** Pinned versions (CommonJS builds; ioredis-mock needs ioredis 5). */
export const REDIS_DEPENDENCIES = {
  ioredis: '^5.11.1',
  '@nest-lab/throttler-storage-redis': '^1.2.0',
};
export const REDIS_DEV_DEPENDENCIES = {
  'ioredis-mock': '^8.13.1',
  '@types/ioredis-mock': '^8.2.8',
};

const REDIS_SERVICE = `image: redis:7.4-alpine
restart: unless-stopped
command: ["redis-server", "--appendonly", "yes"]
ports:
  - "6379:6379"
volumes:
  - redis-data:/data
healthcheck:
  test: ["CMD", "redis-cli", "ping"]
  interval: 5s
  timeout: 3s
  retries: 10`;

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

/**
 * `npm run g -- redis`: an ioredis client (REDIS_URL, lazy connect, none during
 * swagger:export) in a global RedisModule that swaps the starter's seams to
 * Redis: `CACHE_STORE` (admin session cache, sign-in counters, settings
 * cache), the throttler storage, and a readiness check. Without REDIS_URL the
 * app boots on the in-memory fallbacks with a warning.
 */
export function redis(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const root = options.root ?? '';
    const project = getProject(tree, root);
    const files = apply(url('./files'), [root ? move(root) : noop()]);

    const wire: Rule = (host: Tree) => {
      addBarrelExport(host, `${project.commonSrc}/index.ts`, 'redis');
      addModuleImport(host, project.apiModule, 'RedisModule', '@app/common');
      if (!/\bCacheStoreModule\b/.test(readText(host, project.apiModule))) {
        context.logger.warn(
          'apps/api/src/api.module.ts has no CacheStoreModule (project made by an older nest-schematics): ' +
            'the session cache stays in memory until you inject CACHE_STORE from @app/common.',
        );
      }

      const health = `${project.apiSrc}/health/health.controller.ts`;
      if (hasMarker(host, health, MARKERS.healthInject)) {
        insertAtMarker(host, health, MARKERS.healthInject, 'private readonly redis: RedisHealthIndicator,');
        insertAtMarker(host, health, MARKERS.healthCheck, "() => this.redis.pingCheck('redis'),");
        insertAtMarker(host, health, MARKERS.healthReady, "() => this.redis.pingCheck('redis', 1000),");
        addNamedImports(host, health, [{ name: 'RedisHealthIndicator', from: '@app/common' }]);
      } else {
        context.logger.warn(`${health} has no "${MARKERS.healthInject}" marker: add RedisHealthIndicator checks yourself.`);
      }

      addComposeService(host, 'redis', REDIS_SERVICE, ['redis-data'], root);
      const compose = prefixed(root, 'docker-compose.yml');
      if (hasMarker(host, compose, MARKERS.composeApiEnvironment)) {
        insertAtMarker(host, compose, MARKERS.composeApiEnvironment, 'REDIS_URL: redis://redis:6379', 'REDIS_URL:');
      }

      addPackageJson(host, { dependencies: REDIS_DEPENDENCIES, devDependencies: REDIS_DEV_DEPENDENCIES }, root);
      addEnv(
        host,
        {
          title: 'Redis',
          vars: [
            {
              key: 'REDIS_URL',
              value: 'redis://localhost:6379',
              comment:
                'redis://[user:password@]host:port[/db] or rediss:// (TLS). Empty = in-memory cache, session cache and rate limits (one instance only)',
            },
          ],
        },
        root,
      );

      recordFeature(host, 'redis', {}, undefined, root);
      scheduleInstall(context, options.skipInstall, root);
      return host;
    };

    return chain([
      mergeSafe(files, options.force),
      wire,
      (_host: Tree, ctx: SchematicContext) => {
        ctx.logger.info(
          'Redis: docker compose up -d redis (REDIS_URL in .env). Session cache, sign-in limits, rate limits and ' +
            'CACHE_STORE now use Redis; with REDIS_URL empty they fall back to memory.',
        );
      },
    ]);
  };
}
