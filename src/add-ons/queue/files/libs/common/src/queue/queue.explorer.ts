import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { JOB_HANDLER_METADATA, JobHandlerMetadata } from './job-handler.decorator';
import { JobsService } from './jobs.service';
import { JobContext } from './queue.types';

/**
 * Finds every `@JobHandler` method of this app's providers, registers it with
 * JobsService and, after bootstrap, starts the BullMQ workers (redis driver
 * with processors on).
 */
@Injectable()
export class QueueExplorer implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger('Queue');

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (!instance || typeof instance !== 'object' || wrapper.isAlias) continue;
      const prototype = Object.getPrototypeOf(instance) as object | null;
      if (!prototype) continue;
      for (const method of this.scanner.getAllMethodNames(prototype)) {
        const fn = (instance as Record<string, unknown>)[method];
        if (typeof fn !== 'function') continue;
        const meta = this.reflector.get<JobHandlerMetadata | undefined>(JOB_HANDLER_METADATA, fn);
        if (!meta) continue;
        this.jobs.registerHandler({
          ...meta,
          source: `${instance.constructor.name}.${method}`,
          run: (data: unknown, job: JobContext) => Promise.resolve(fn.call(instance, data, job)),
        });
      }
    }
  }

  onApplicationBootstrap(): void {
    this.jobs.startWorkers();
    if (this.jobs.driver === 'memory') {
      this.logger.warn('REDIS_URL is not set: jobs run in this process from memory and are lost on restart.');
    }
  }
}
