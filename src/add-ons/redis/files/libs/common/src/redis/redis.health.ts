import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.config';

/**
 * Terminus check for `/api/health/ready`: PING with a timeout. Without
 * REDIS_URL the app runs on in-memory fallbacks, so the check reports `up`
 * with `mode: 'memory'`.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly health: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  async pingCheck(key: string, timeoutMs = 3000) {
    const indicator = this.health.check(key);
    if (!this.redis) return indicator.up({ mode: 'memory' });
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`no PONG within ${timeoutMs}ms`)), timeoutMs);
      });
      await Promise.race([this.redis.ping(), timeout]);
      return indicator.up({ mode: 'redis' });
    } catch (error) {
      return indicator.down({ mode: 'redis', message: (error as Error).message });
    } finally {
      clearTimeout(timer);
    }
  }
}
