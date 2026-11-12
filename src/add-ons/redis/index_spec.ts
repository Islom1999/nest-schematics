import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';

const API_MODULE = '/apps/api/src/api.module.ts';
const HEALTH = '/apps/api/src/health/health.controller.ts';
const CLIENT_AUTH = '/apps/api/src/client-auth/client-auth.service.ts';

describe('redis add-on', () => {
  const runner = createRunner();
  let tree: UnitTestTree;

  async function run(names: [string, Record<string, unknown>?][], start?: UnitTestTree): Promise<UnitTestTree> {
    let t = start ?? (await createStarterTree(runner));
    for (const [name, options] of names) t = await runner.runSchematic(name, { skipInstall: true, ...options }, t);
    return t;
  }

  beforeAll(async () => {
    tree = await run([['redis']]);
  });

  it('adds the Redis library to libs/common', () => {
    for (const f of ['redis.config', 'redis-cache-store', 'redis.health', 'redis.module', 'index']) {
      expect(tree.exists(`/libs/common/src/redis/${f}.ts`)).withContext(f).toBeTrue();
    }
    expect(tree.readContent('/libs/common/src/index.ts')).toContain("export * from './redis';");
    const config = tree.readContent('/libs/common/src/redis/redis.config.ts');
    expect(config).toContain('if (isSwaggerExport()) return null;');
    expect(config).toContain('lazyConnect: true');
    expect(config).toContain('REDIS_URL is not set');
  });

  it('swaps the starter seams by provider token (session cache, sign-in limits, throttler storage)', () => {
    const module = tree.readContent('/libs/common/src/redis/redis.module.ts');
    expect(module).toContain('provide: SHARED_CACHE_STORE');
    expect(module).toContain('provide: SHARED_THROTTLER_STORAGE');
    expect(module).toContain('new ThrottlerStorageRedisService(redis)');
    // The starter consumes those tokens optionally; the guards are not rewritten.
    const api = tree.readContent(API_MODULE);
    expect(api).toContain('{ token: SHARED_THROTTLER_STORAGE, optional: true }');
    expect(api).toMatch(/imports: \[[\s\S]*CacheStoreModule,[\s\S]*RedisModule,\n {2}\]/);
    expect(api).toMatch(/import \{[^}]*\bRedisModule\b[^}]*\} from '@app\/common';/);
    expect(tree.readContent('/libs/common/src/cache/cache.module.ts')).toContain('shared ?? new MemoryCacheStore()');
    const auth = tree.readContent('/apps/api/src/auth/auth.service.ts');
    expect(auth).toContain('@Inject(CACHE_STORE) private readonly cache: CacheStore');
    expect(auth).toContain("cache.shared ? cache : undefined, 'admin-sign-in'");
  });

  it('adds liveness and readiness checks', () => {
    const health = tree.readContent(HEALTH);
    expect(health).toContain('private readonly redis: RedisHealthIndicator,\n    // @ns:health-inject');
    expect(health).toContain("() => this.redis.pingCheck('redis'),");
    expect(health).toContain("() => this.redis.pingCheck('redis', 1000),");
    expect(health).toMatch(/import \{[^}]*RedisHealthIndicator[^}]*\} from '@app\/common';/);
  });

  it('adds a pinned docker-compose service, REDIS_URL and the dependencies', () => {
    const compose = tree.readContent('/docker-compose.yml');
    expect(compose).toContain('image: redis:7.4-alpine');
    expect(compose).toContain('redis-data:');
    expect(compose).toContain('REDIS_URL: redis://redis:6379');
    expect(tree.readContent('/.env.example')).toContain('\nREDIS_URL=redis://localhost:6379\n');
    expect(tree.readContent('/libs/common/src/config/env.validation.ts')).toContain('REDIS_URL?: string;');
    const pkg = JSON.parse(tree.readContent('/package.json')) as Record<string, Record<string, string>>;
    expect(pkg.dependencies['ioredis']).toBe('^5.11.1');
    expect(pkg.dependencies['@nest-lab/throttler-storage-redis']).toBe('^1.2.0');
    expect(pkg.devDependencies['ioredis-mock']).toBeDefined();
    expect(JSON.parse(tree.readContent('/nest-schematics.json')).features.redis).toBeDefined();
  });

  it('is idempotent', async () => {
    const before = snapshot(tree);
    const again = await runner.runSchematic('redis', { skipInstall: true }, tree);
    expect(snapshot(again)).toEqual(before);
  });

  it('gives the same session cache wiring with auth-client installed before or after it', async () => {
    const authFirst = await run([['sms', { provider: 'log' }], ['auth-client'], ['redis']]);
    const redisFirst = await run([['redis'], ['sms', { provider: 'log' }], ['auth-client']]);
    for (const t of [authFirst, redisFirst]) {
      const service = t.readContent(CLIENT_AUTH);
      expect(service).toContain('@Inject(CACHE_STORE) private readonly cache: CacheStore');
      expect(service).not.toContain('TtlCache');
      expect(t.readContent('/apps/api/src/client-auth/phone/phone-auth.service.ts')).toContain('cache.shared ? cache : undefined');
      expect(t.readContent(API_MODULE)).toContain('RedisModule');
    }
    for (const file of [CLIENT_AUTH, HEALTH, '/libs/common/src/redis/redis.module.ts', '/docker-compose.yml']) {
      expect(redisFirst.readContent(file)).withContext(file).toBe(authFirst.readContent(file));
    }
  });

  it('gives the same settings cache with settings installed before or after it', async () => {
    const settingsFirst = await run([['settings'], ['redis']]);
    const redisFirst = await run([['redis'], ['settings']]);
    for (const t of [settingsFirst, redisFirst]) {
      expect(t.readContent('/libs/common/src/settings/settings.service.ts')).toContain('@Inject(CACHE_STORE) private readonly cache: CacheStore');
      const api = t.readContent(API_MODULE);
      expect(api).toContain('RedisModule');
      expect(api).toContain('SettingsModule');
    }
    expect(redisFirst.readContent('/libs/common/src/settings/settings.service.ts')).toBe(
      settingsFirst.readContent('/libs/common/src/settings/settings.service.ts'),
    );
  });
});
