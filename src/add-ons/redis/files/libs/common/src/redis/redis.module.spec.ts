import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { CACHE_STORE, CacheStore, CacheStoreModule, MemoryCacheStore } from '../cache';
import { SHARED_THROTTLER_STORAGE } from '../config/throttler.config';
import { RedisCacheStore } from './redis-cache-store';
import { REDIS_CLIENT, redisOptionsFromUrl } from './redis.config';
import { RedisHealthIndicator } from './redis.health';
import { RedisModule } from './redis.module';

/** No Redis server is needed: the client is replaced or never connects (lazyConnect). */
async function compile(env: Record<string, string>, client?: unknown) {
  let builder = Test.createTestingModule({
    imports: [ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => env] }), CacheStoreModule, RedisModule],
  });
  if (client !== undefined) builder = builder.overrideProvider(REDIS_CLIENT).useValue(client);
  return builder.compile();
}

describe('RedisModule', () => {
  const saved = process.env.REDIS_URL;
  beforeEach(() => delete process.env.REDIS_URL);
  afterAll(() => {
    if (saved !== undefined) process.env.REDIS_URL = saved;
  });

  it('without REDIS_URL keeps the in-memory fallbacks', async () => {
    const moduleRef = await compile({});
    expect(moduleRef.get(REDIS_CLIENT)).toBeNull();
    expect(moduleRef.get<CacheStore>(CACHE_STORE)).toBeInstanceOf(MemoryCacheStore);
    expect(moduleRef.get(SHARED_THROTTLER_STORAGE)).toBeNull();
    const health = await moduleRef.get(RedisHealthIndicator).pingCheck('redis');
    expect(health).toEqual({ redis: { status: 'up', mode: 'memory' } });
  });

  it('with Redis swaps CACHE_STORE and the throttler storage to Redis', async () => {
    const client = new Redis({ lazyConnect: true });
    try {
      const moduleRef = await compile({ REDIS_URL: 'redis://localhost:6379' }, client);
      const store = moduleRef.get<CacheStore>(CACHE_STORE);
      expect(store).toBeInstanceOf(RedisCacheStore);
      expect(store.shared).toBe(true);
      const throttler = moduleRef.get<ThrottlerStorageRedisService>(SHARED_THROTTLER_STORAGE);
      expect(throttler).toBeInstanceOf(ThrottlerStorageRedisService);
      expect(throttler.redis).toBe(client);
    } finally {
      client.disconnect();
    }
  });

  it('reports Redis health with PING', async () => {
    const mock = new RedisMock({ host: 'health-spec' });
    const moduleRef = await compile({ REDIS_URL: 'redis://health-spec:6379' }, mock);
    expect(await moduleRef.get(RedisHealthIndicator).pingCheck('redis')).toEqual({ redis: { status: 'up', mode: 'redis' } });
    const broken = { ping: () => Promise.reject(new Error('ECONNREFUSED')) };
    const down = await (await compile({ REDIS_URL: 'redis://x:6379' }, broken)).get(RedisHealthIndicator).pingCheck('redis');
    expect(down).toEqual({ redis: { status: 'down', mode: 'redis', message: 'ECONNREFUSED' } });
    mock.disconnect();
  });

  it('parses REDIS_URL', () => {
    expect(redisOptionsFromUrl('redis://localhost:6379')).toEqual({ host: 'localhost', port: 6379 });
    expect(redisOptionsFromUrl('rediss://u:p%40ss@cache.example.com:6380/2')).toEqual({
      host: 'cache.example.com',
      port: 6380,
      username: 'u',
      password: 'p@ss',
      db: 2,
      tls: {},
    });
    expect(() => redisOptionsFromUrl('http://localhost')).toThrow('REDIS_URL must start with redis://');
  });
});
