import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  backoffDelay,
  DEFAULT_JOB_OPTIONS,
  DEFAULT_QUEUE,
  EnqueuedJob,
  EnqueueOptions,
  JobContext,
  QueueCounts,
  QueueDriver,
} from './queue.types';

/** How QueueModule.forRoot() set this process up. */
export interface QueueRuntime {
  driver: QueueDriver;
  /** BullMQ connection (redis driver). */
  connection?: RedisOptions;
  /** Start BullMQ workers for the `@JobHandler`s of this process. */
  processors: boolean;
  /** Queues known up front (`default` + forRoot/forFeature), listed by `stats()`. */
  queues: Set<string>;
}

export const QUEUE_RUNTIME = 'QUEUE_RUNTIME';

export interface RegisteredHandler {
  queue: string;
  name: string;
  concurrency: number;
  /** Where it was declared, for error messages (`MailJobs.send`). */
  source: string;
  run: (data: unknown, job: JobContext) => Promise<unknown>;
}

interface MemoryJob {
  id: string;
  name: string;
  queue: string;
  data: unknown;
  attempt: number;
  attempts: number;
  backoff: EnqueueOptions['backoff'];
}

function handlerKey(queue: string, name: string): string {
  return `${queue}\u0000${name}`;
}

/**
 * Background jobs for every module and add-on (mail, notifications, ai...):
 *
 *   await jobs.enqueue('mail.send', { to, subject }, { delay: 5000 });
 *
 * Handlers are provider methods marked with `@JobHandler('mail.send')`. Every
 * job gets {@link DEFAULT_JOB_OPTIONS} (3 attempts, exponential backoff)
 * unless `opts` overrides them.
 *
 * Drivers (chosen once by QueueModule.forRoot()):
 * - `redis` (REDIS_URL set): BullMQ. Jobs survive restarts; workers run in
 *   apps/worker when it is installed, otherwise in the api process.
 * - `memory` (REDIS_URL empty): jobs run in this process after `delay`, with
 *   the same retries/backoff, but are lost on restart. For development only.
 */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly logger = new Logger('Queue');
  private readonly handlers = new Map<string, RegisteredHandler>();
  private readonly queues = new Map<string, Queue>();
  private readonly ownedQueues: Queue[] = [];
  private readonly workers: Worker[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly memoryCounts = new Map<string, QueueCounts>();
  private closed = false;

  constructor(
    @Inject(QUEUE_RUNTIME) private readonly runtime: QueueRuntime,
    private readonly moduleRef: ModuleRef,
  ) {}

  get driver(): QueueDriver {
    return this.runtime.driver;
  }

  /** Adds a job. Resolves once it is stored (redis) or scheduled (memory). */
  async enqueue<T>(name: string, data: T, opts: EnqueueOptions = {}): Promise<EnqueuedJob> {
    const { queue: queueName = DEFAULT_QUEUE, ...jobOptions } = opts;
    const options = { ...DEFAULT_JOB_OPTIONS, ...jobOptions };
    if (this.runtime.driver === 'redis') {
      const job = await this.queue(queueName).add(name, data, options);
      return { id: String(job.id), name, queue: queueName };
    }
    const job: MemoryJob = {
      id: options.jobId ?? randomUUID(),
      name,
      queue: queueName,
      data,
      attempt: 1,
      attempts: Math.max(1, options.attempts ?? 1),
      backoff: options.backoff,
    };
    const delay = Math.max(0, options.delay ?? 0);
    this.count(queueName, delay ? 'delayed' : 'waiting', 1);
    this.schedule(job, delay);
    return { id: job.id, name, queue: queueName };
  }

  /** Job counts per queue (admin/queues). */
  async stats(): Promise<QueueCounts[]> {
    const names = [...new Set([...this.runtime.queues, ...[...this.handlers.values()].map((h) => h.queue)])].sort();
    if (this.runtime.driver === 'memory') return names.map((name) => ({ ...this.counts(name) }));
    return Promise.all(
      names.map(async (name) => {
        const c = await this.queue(name).getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
        return {
          name,
          waiting: c.waiting ?? 0,
          active: c.active ?? 0,
          delayed: c.delayed ?? 0,
          completed: c.completed ?? 0,
          failed: c.failed ?? 0,
        };
      }),
    );
  }

  /** Called by QueueExplorer for every `@JobHandler` found in this process. */
  registerHandler(handler: RegisteredHandler): void {
    const key = handlerKey(handler.queue, handler.name);
    const existing = this.handlers.get(key);
    if (existing) {
      throw new Error(
        `Job "${handler.name}" (queue "${handler.queue}") has two handlers: ${existing.source} and ${handler.source}`,
      );
    }
    this.handlers.set(key, handler);
  }

  /** Starts one BullMQ worker per queue that has handlers (redis driver, processors on). */
  startWorkers(): void {
    if (this.runtime.driver !== 'redis' || !this.runtime.processors) return;
    const byQueue = new Map<string, number>();
    for (const h of this.handlers.values()) byQueue.set(h.queue, Math.max(byQueue.get(h.queue) ?? 1, h.concurrency));
    for (const [queue, concurrency] of byQueue) {
      const worker = new Worker(queue, (job: Job) => this.process(queue, job), {
        connection: { ...this.runtime.connection, maxRetriesPerRequest: null },
        concurrency,
      });
      worker.on('failed', (job, error) =>
        this.logger.warn(`${queue}/${job?.name ?? '?'} #${job?.id ?? '?'} failed (attempt ${job?.attemptsMade ?? '?'}): ${error.message}`),
      );
      worker.on('error', (error) => this.logger.error(`${queue} worker: ${error.message}`));
      this.workers.push(worker);
      this.logger.log(`Processing queue "${queue}" (concurrency ${concurrency})`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled([...this.workers.map((w) => w.close()), ...this.ownedQueues.map((q) => q.close())]);
  }

  // ── redis driver ─────────────────────────────────────────────────────

  private queue(name: string): Queue {
    let queue = this.queues.get(name);
    if (queue) return queue;
    try {
      queue = this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
    } catch {
      // Not registered with BullModule: own it.
      queue = new Queue(name, { connection: this.runtime.connection ?? {}, defaultJobOptions: DEFAULT_JOB_OPTIONS });
      this.ownedQueues.push(queue);
    }
    this.queues.set(name, queue);
    return queue;
  }

  private async process(queue: string, job: Job): Promise<unknown> {
    const handler = this.handlers.get(handlerKey(queue, job.name));
    if (!handler) throw new UnrecoverableError(`No @JobHandler('${job.name}') for queue "${queue}" in this process`);
    const data: unknown = job.data;
    return handler.run(data, { id: String(job.id), name: job.name, queue, data, attempt: job.attemptsMade + 1 });
  }

  // ── memory driver ────────────────────────────────────────────────────

  private schedule(job: MemoryJob, delay: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void this.runMemory(job, delay > 0 || job.attempt > 1 ? 'delayed' : 'waiting');
    }, delay);
    this.timers.add(timer);
  }

  private async runMemory(job: MemoryJob, from: 'waiting' | 'delayed'): Promise<void> {
    if (this.closed) return;
    this.count(job.queue, from, -1);
    this.count(job.queue, 'active', 1);
    const handler = this.handlers.get(handlerKey(job.queue, job.name));
    try {
      if (!handler) throw new Error(`No @JobHandler('${job.name}') for queue "${job.queue}" in this process`);
      await handler.run(job.data, { id: job.id, name: job.name, queue: job.queue, data: job.data, attempt: job.attempt });
      this.count(job.queue, 'completed', 1);
    } catch (error) {
      const message = (error as Error).message;
      if (handler && job.attempt < job.attempts) {
        const delay = backoffDelay(job.backoff, job.attempt);
        this.logger.warn(`${job.queue}/${job.name} #${job.id} attempt ${job.attempt} failed: ${message}; retry in ${delay}ms`);
        job.attempt += 1;
        this.count(job.queue, 'delayed', 1);
        this.schedule(job, delay);
      } else {
        this.logger.error(`${job.queue}/${job.name} #${job.id} failed after ${job.attempt} attempt(s): ${message}`);
        this.count(job.queue, 'failed', 1);
      }
    } finally {
      this.count(job.queue, 'active', -1);
    }
  }

  private counts(queue: string): QueueCounts {
    let counts = this.memoryCounts.get(queue);
    if (!counts) {
      counts = { name: queue, waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 };
      this.memoryCounts.set(queue, counts);
    }
    return counts;
  }

  private count(queue: string, field: Exclude<keyof QueueCounts, 'name'>, delta: number): void {
    this.counts(queue)[field] += delta;
  }
}
