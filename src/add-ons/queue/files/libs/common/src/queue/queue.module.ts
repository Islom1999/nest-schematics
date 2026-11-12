import { DynamicModule, Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { redisOptionsFromUrl } from '../redis/redis.config';
import { isSwaggerExport } from '../swagger/export-mode';
import { JobsService, QUEUE_RUNTIME, QueueRuntime } from './jobs.service';
import { QueueExplorer } from './queue.explorer';
import { DEFAULT_JOB_OPTIONS, DEFAULT_QUEUE, QueueModuleOptions } from './queue.types';

/** Queues named in forRoot/forFeature (listed by JobsService.stats()). */
const KNOWN_QUEUES = new Set<string>([DEFAULT_QUEUE]);

/** Waits until ConfigModule has loaded .env (as `ConditionalModule` does), at most 5s. */
async function envLoaded(): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, 5000);
    timer.unref();
  });
  await Promise.race([ConfigModule.envVariablesLoaded, timeout]);
  clearTimeout(timer);
}

/** REDIS_URL after .env is loaded; empty during swagger:export (nothing may connect). */
async function redisUrl(): Promise<string> {
  await envLoaded();
  return isSwaggerExport() ? '' : (process.env.REDIS_URL?.trim() ?? '');
}

@Module({})
class QueueFeatureModule {}

/**
 * Background jobs (`npm run g -- queue`) on BullMQ via @nestjs/bullmq.
 *
 * - `QueueModule.forRoot()` once per app (api, worker): global JobsService,
 *   the `default` queue and `@JobHandler` discovery. The driver is picked from
 *   REDIS_URL when the app starts: BullMQ with it, in-process memory without
 *   it (logged as a warning; jobs are lost on restart).
 * - `QueueModule.forFeature('mail', 'push')` registers named queues; with
 *   Redis `@InjectQueue('mail')` works too (prefer JobsService: it also works
 *   without Redis).
 *
 * Processors: `forRoot({ processors: false })` in the api once apps/worker is
 * installed (the generator sets it), so only the worker consumes jobs. Without
 * the worker the api runs them.
 */
@Module({})
export class QueueModule {
  static async forRoot(options: QueueModuleOptions = {}): Promise<DynamicModule> {
    const url = await redisUrl();
    for (const name of options.queues ?? []) KNOWN_QUEUES.add(name);
    const runtime: QueueRuntime = {
      driver: url ? 'redis' : 'memory',
      connection: url ? redisOptionsFromUrl(url) : undefined,
      processors: options.processors !== false,
      queues: KNOWN_QUEUES,
    };
    if (!url && !isSwaggerExport()) {
      new Logger('Queue').warn('REDIS_URL is not set: using the in-memory job queue (development only).');
    }
    const bull = runtime.connection
      ? [
          BullModule.forRoot({ connection: runtime.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
          BullModule.registerQueue(...[...KNOWN_QUEUES].map((name) => ({ name }))),
        ]
      : [];
    return {
      module: QueueModule,
      global: true,
      imports: [DiscoveryModule, ...bull],
      providers: [{ provide: QUEUE_RUNTIME, useValue: runtime }, JobsService, QueueExplorer],
      exports: [JobsService],
    };
  }

  static async forFeature(...queues: string[]): Promise<DynamicModule> {
    const url = await redisUrl();
    for (const name of queues) KNOWN_QUEUES.add(name);
    if (!url || !queues.length) return { module: QueueFeatureModule };
    const registered = BullModule.registerQueue(...queues.map((name) => ({ name })));
    return { module: QueueFeatureModule, imports: [registered], exports: [registered] };
  }
}
