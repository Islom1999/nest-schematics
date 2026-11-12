import type Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { LoginAttemptLimiter } from '../auth/login-attempts';
import { RedisCacheStore } from './redis-cache-store';

/**
 * Runs against ioredis-mock (in-process Redis emulation with Lua support);
 * mocks on the same host:port share their data, like two app instances
 * talking to one Redis.
 */
function client(): Redis {
  return new RedisMock({ host: 'cache-spec', port: 6379 });
}

describe('RedisCacheStore', () => {
  let redis: Redis;
  let store: RedisCacheStore;

  beforeEach(async () => {
    redis = client();
    await redis.flushall();
    store = new RedisCacheStore(redis);
  });

  afterEach(() => redis.disconnect());

  it('stores JSON values with an expiry', async () => {
    await store.set('a', { id: 'x', permissions: ['*'] }, 30_000);
    expect(await store.get('a')).toEqual({ id: 'x', permissions: ['*'] });
    expect(await redis.pttl('cache:a')).toBeGreaterThan(29_000);
    expect(await store.get('missing')).toBeUndefined();
    await store.set('b', 1, 0);
    expect(await store.get('b')).toBeUndefined();
  });

  it('deletes keys and prefixes', async () => {
    await store.set('admin-session:1:s1', 1, 30_000);
    await store.set('admin-session:1:s2', 2, 30_000);
    await store.set('admin-session:2:s3', 3, 30_000);
    await store.delete('admin-session:1:s1');
    expect(await store.get('admin-session:1:s1')).toBeUndefined();
    await store.deleteByPrefix('admin-session:1:');
    expect(await store.get('admin-session:1:s2')).toBeUndefined();
    expect(await store.get('admin-session:2:s3')).toBe(3);
    await store.deleteByPrefix('admin-session:');
    expect(await store.get('admin-session:2:s3')).toBeUndefined();
  });

  it('counts within a window that starts on the first hit', async () => {
    expect(await store.counter('c')).toBeUndefined();
    expect((await store.increment('c', 60_000)).count).toBe(1);
    const second = await store.increment('c', 60_000);
    expect(second.count).toBe(2);
    expect(second.resetInMs).toBeGreaterThan(59_000);
    expect(await store.counter('c')).toEqual({ count: 2, resetInMs: expect.any(Number) as number });
  });

  it('shares entries between instances (a revoke on one is seen by the other)', async () => {
    const other = new RedisCacheStore(client());
    await store.set('admin-session:1:s1', { id: '1' }, 30_000);
    expect(await other.get('admin-session:1:s1')).toEqual({ id: '1' });
    await other.delete('admin-session:1:s1');
    expect(await store.get('admin-session:1:s1')).toBeUndefined();
  });

  it('backs LoginAttemptLimiter across instances', async () => {
    const a = new LoginAttemptLimiter(2, 60_000, store, 'admin-sign-in');
    const b = new LoginAttemptLimiter(2, 60_000, new RedisCacheStore(client()), 'admin-sign-in');
    await a.fail('x@y|1.2.3.4');
    expect(await b.fail('x@y|1.2.3.4')).toBe(0);
    await expect(a.assertAllowed('x@y|1.2.3.4')).rejects.toThrow('Too many failed attempts');
    await b.reset('x@y|1.2.3.4');
    await expect(a.assertAllowed('x@y|1.2.3.4')).resolves.toBeUndefined();
  });
});
