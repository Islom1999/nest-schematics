import { Global, Module } from '@nestjs/common';
import { CACHE_STORE, CacheStore, SHARED_CACHE_STORE } from './cache-store';
import { MemoryCacheStore } from './memory-cache-store';

/**
 * Provides `CACHE_STORE` app-wide: the shared store of the redis add-on
 * (`SHARED_CACHE_STORE`) when it is installed and configured, otherwise an
 * in-process {@link MemoryCacheStore}. Consumers never change when Redis is
 * added or removed.
 */
@Global()
@Module({
  providers: [
    {
      provide: CACHE_STORE,
      inject: [{ token: SHARED_CACHE_STORE, optional: true }],
      useFactory: (shared?: CacheStore | null): CacheStore => shared ?? new MemoryCacheStore(),
    },
  ],
  exports: [CACHE_STORE],
})
export class CacheStoreModule {}
