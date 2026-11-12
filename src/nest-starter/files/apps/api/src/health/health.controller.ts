import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '@app/common';

/** Heap above this marks the instance unhealthy (restart it before it dies). */
const HEAP_LIMIT_BYTES = 512 * 1024 * 1024;

/**
 * Probes for load balancers, Docker and Kubernetes. Public and not rate limited
 * (probes come from a few IPs). 200 = healthy, 503 = unhealthy with details.
 */
@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    // @ns:health-inject
  ) {}

  /** Everything: database, memory and the services add-ons register. */
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 3000 }),
      () => this.memory.checkHeap('memory_heap', HEAP_LIMIT_BYTES),
      // @ns:health-check
    ]);
  }

  /** Liveness: the process answers. Never depends on the database (no restart loops). */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /** Readiness: can serve traffic (database and the services add-ons register, e.g. Redis). */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 3000 }),
      // @ns:health-ready
    ]);
  }
}
