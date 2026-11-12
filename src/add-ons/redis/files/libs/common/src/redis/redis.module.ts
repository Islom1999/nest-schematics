import { Global, Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type Redis from 'ioredis';
import { SHARED_CACHE_STORE } from '../cache/cache-store';
import { SHARED_THROTTLER_STORAGE } from '../config/throttler.config';
import { RedisCacheStore } from './redis-cache-store';
import { createRedisClient, REDIS_CLIENT } from './redis.config';
import { RedisHealthIndicator } from './redis.health';

/** Checks the connection once the app is up and closes it on shutdown. */
@Injectable()
export class RedisLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Redis');

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.ping();
      this.logger.log(`Connected to ${this.redis.options.host}:${this.redis.options.port}`);
    } catch (error) {
      // Not fatal: ioredis keeps reconnecting and /api/health/ready reports it.
      this.logger.error(`Redis is not reachable yet: ${(error as Error).message}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis && this.redis.status !== 'end') await this.redis.quit().catch(() => undefined);
  }
}

/**
 * Redis (`npm run g -- redis`). Global: provides
 * - `REDIS_CLIENT` (ioredis, `null` without REDIS_URL or during swagger:export);
 * - `SHARED_CACHE_STORE` → becomes `CACHE_STORE` (session cache, sign-in
 *   counters, settings cache) through CacheStoreModule;
 * - `SHARED_THROTTLER_STORAGE` → rate limits count across instances
 *   (@nest-lab/throttler-storage-redis);
 * - `RedisHealthIndicator` for `/api/health/ready`.
 * With REDIS_URL empty every one of them falls back to memory and the app boots.
 */
@Global()
@Module({
  imports: [TerminusModule],
  providers: [
    { provide: REDIS_CLIENT, inject: [ConfigService], useFactory: (config: ConfigService) => createRedisClient(config) },
    {
      provide: SHARED_CACHE_STORE,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis | null) => (redis ? new RedisCacheStore(redis) : null),
    },
    {
      provide: SHARED_THROTTLER_STORAGE,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis | null) => (redis ? new ThrottlerStorageRedisService(redis) : null),
    },
    RedisHealthIndicator,
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT, SHARED_CACHE_STORE, SHARED_THROTTLER_STORAGE, RedisHealthIndicator],
})
export class RedisModule {}
