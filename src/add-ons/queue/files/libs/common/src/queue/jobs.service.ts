import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  jobRetryDelay,
  CleanableStatus,
  DEFAULT_JOB_OPTIONS,
  DEFAULT_QUEUE,
  EnqueuedJob,
  EnqueueOptions,
  JobContext,
  JobInfo,
  JobPage,
  JobStatus,
  QueueCounts,
  QueueDriver,
  redactJobData,
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
  status: JobStatus;
  createdAt: number;
  processedAt?: number;
  finishedAt?: number;
  failedReason?: string;
  /** Set while the job waits for its delay (or a retry backoff). */
  timer?: NodeJS.Timeout;
}

/** The memory driver keeps this many finished jobs per queue and state, like BullMQ's `removeOnComplete`. */
const MEMORY_KEEP_FINISHED = 1000;

function handlerKey(queue: string, name: string): string {
  return `${queue}\u0000${name}`;
}

function memoryKey(queue: string, id: string): string {
  return `${queue}\u0000${id}`;
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
 *
 * The admin panel (`admin/queues`) uses `stats()`, `listJobs()`, `retryJob()`,
 * `clean()`, `pauseQueue()` and `resumeQueue()`, which work on both drivers.
 */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly logger = new Logger('Queue');
  private readonly handlers = new Map<string, RegisteredHandler>();
  private readonly queues = new Map<string, Queue>();
  private readonly ownedQueues: Queue[] = [];
  private readonly workers: Worker[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  /** Memory driver: every job still known, oldest first (key `queue\0id`). */
  private readonly memoryJobs = new Map<string, MemoryJob>();
  private readonly pausedQueues = new Set<string>();
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
    const id = options.jobId ?? randomUUID();
    // Like BullMQ: a job id that is already known is not added twice.
    if (this.memoryJobs.has(memoryKey(queueName, id))) return { id, name, queue: queueName };
    const delay = Math.max(0, options.delay ?? 0);
    const job: MemoryJob = {
      id,
      name,
      queue: queueName,
      data,
      attempt: 1,
      attempts: Math.max(1, options.attempts ?? 1),
      backoff: options.backoff,
      status: delay ? 'delayed' : 'waiting',
      createdAt: Date.now(),
    };
    this.memoryJobs.set(memoryKey(queueName, id), job);
    this.schedule(job, delay);
    return { id: job.id, name, queue: queueName };
  }

  /** Job counts per queue (admin/queues). */
  async stats(): Promise<QueueCounts[]> {
    const names = this.queueNames();
    if (this.runtime.driver === 'memory') return names.map((name) => this.memoryCounts(name));
    return Promise.all(
      names.map(async (name) => {
        const queue = this.queue(name);
        const [c, paused] = await Promise.all([
          queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
          queue.isPaused(),
        ]);
        return {
          name,
          waiting: c.waiting ?? 0,
          active: c.active ?? 0,
          delayed: c.delayed ?? 0,
          completed: c.completed ?? 0,
          failed: c.failed ?? 0,
          paused,
        };
      }),
    );
  }

  /** Jobs of one queue in one state, newest first (`page` starts at 1, `limit` at most 100). */
  async listJobs(queueName: string, status: JobStatus, page = 1, limit = 20): Promise<JobPage> {
    this.assertQueue(queueName);
    const size = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100);
    const skip = (Math.max(Math.trunc(page) || 1, 1) - 1) * size;
    if (this.runtime.driver === 'memory') {
      const all = [...this.memoryJobs.values()].filter((j) => j.queue === queueName && j.status === status).reverse();
      return { count: all.length, data: all.slice(skip, skip + size).map((j) => this.memoryInfo(j)) };
    }
    const queue = this.queue(queueName);
    const [count, jobs] = await Promise.all([queue.getJobCountByTypes(status), queue.getJobs([status], skip, skip + size - 1, false)]);
    return { count, data: jobs.filter((j): j is Job => !!j).map((j) => this.redisInfo(queueName, j, status)) };
  }

  /** Runs a failed job again from its first attempt. 404 when unknown, 409 when it did not fail. */
  async retryJob(queueName: string, id: string): Promise<void> {
    this.assertQueue(queueName);
    if (this.runtime.driver === 'memory') {
      const job = this.memoryJobs.get(memoryKey(queueName, id));
      if (!job) throw new NotFoundException(`Job "${id}" not found`);
      if (job.status !== 'failed') throw new ConflictException(`Job "${id}" is ${job.status}, only failed jobs can be retried`);
      job.attempt = 1;
      job.status = 'waiting';
      job.failedReason = undefined;
      job.finishedAt = undefined;
      this.schedule(job, 0);
      return;
    }
    const job = await this.queue(queueName).getJob(id);
    if (!job) throw new NotFoundException(`Job "${id}" not found`);
    const state = await job.getState();
    if (state !== 'failed') throw new ConflictException(`Job "${id}" is ${state}, only failed jobs can be retried`);
    await job.retry('failed', { resetAttemptsMade: true });
  }

  /**
   * Removes jobs of one state that are at least `olderThanMs` old (0 = all of
   * them) and returns how many. Active jobs are never touched.
   */
  async clean(queueName: string, status: CleanableStatus, olderThanMs: number): Promise<number> {
    this.assertQueue(queueName);
    const grace = Math.max(0, Math.trunc(olderThanMs) || 0);
    if (this.runtime.driver === 'memory') {
      const limit = Date.now() - grace;
      let removed = 0;
      for (const [key, job] of [...this.memoryJobs]) {
        if (job.queue !== queueName || job.status !== status || (job.finishedAt ?? job.createdAt) > limit) continue;
        this.clearTimer(job);
        this.memoryJobs.delete(key);
        removed++;
      }
      return removed;
    }
    const ids = await this.queue(queueName).clean(grace, 0, status === 'waiting' ? 'wait' : status);
    return ids.length;
  }

  /** Workers of the queue take no new jobs until {@link resumeQueue}; running jobs finish. */
  async pauseQueue(queueName: string): Promise<void> {
    this.assertQueue(queueName);
    if (this.runtime.driver === 'memory') this.pausedQueues.add(queueName);
    else await this.queue(queueName).pause();
  }

  async resumeQueue(queueName: string): Promise<void> {
    this.assertQueue(queueName);
    if (this.runtime.driver === 'redis') {
      await this.queue(queueName).resume();
      return;
    }
    this.pausedQueues.delete(queueName);
    // Jobs that came due while paused (waiting, no timer) start now.
    for (const job of this.memoryJobs.values()) {
      if (job.queue === queueName && job.status === 'waiting' && !job.timer) this.schedule(job, 0);
    }
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

  /** Queues this process knows: forRoot/forFeature, handlers and (memory) jobs. */
  private queueNames(): string[] {
    const names = new Set([...this.runtime.queues, ...[...this.handlers.values()].map((h) => h.queue)]);
    for (const job of this.memoryJobs.values()) names.add(job.queue);
    return [...names].sort();
  }

  /** 404 unless the queue is known: admin routes never create queues. */
  private assertQueue(name: string): void {
    if (!this.queueNames().includes(name)) throw new NotFoundException(`Queue "${name}" not found`);
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

  private redisInfo(queue: string, job: Job, status: JobStatus): JobInfo {
    const iso = (ms?: number) => (typeof ms === 'number' ? new Date(ms).toISOString() : null);
    return {
      id: String(job.id),
      name: job.name,
      queue,
      status,
      data: redactJobData(job.data),
      attemptsMade: job.attemptsMade,
      attempts: job.opts?.attempts ?? null,
      failedReason: job.failedReason || null,
      createdAt: iso(job.timestamp),
      processedAt: iso(job.processedOn),
      finishedAt: iso(job.finishedOn),
    };
  }

  // ── memory driver ────────────────────────────────────────────────────

  private schedule(job: MemoryJob, delay: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      job.timer = undefined;
      // Paused: the job stays `waiting` (no timer) until resumeQueue().
      if (this.pausedQueues.has(job.queue)) job.status = 'waiting';
      else void this.runMemory(job);
    }, delay);
    job.timer = timer;
    this.timers.add(timer);
  }

  private clearTimer(job: MemoryJob): void {
    if (!job.timer) return;
    clearTimeout(job.timer);
    this.timers.delete(job.timer);
    job.timer = undefined;
  }

  private async runMemory(job: MemoryJob): Promise<void> {
    if (this.closed) return;
    job.status = 'active';
    job.processedAt = Date.now();
    const handler = this.handlers.get(handlerKey(job.queue, job.name));
    try {
      if (!handler) throw new Error(`No @JobHandler('${job.name}') for queue "${job.queue}" in this process`);
      await handler.run(job.data, { id: job.id, name: job.name, queue: job.queue, data: job.data, attempt: job.attempt });
      this.finish(job, 'completed');
    } catch (error) {
      const message = (error as Error).message;
      job.failedReason = message;
      if (handler && job.attempt < job.attempts) {
        const delay = jobRetryDelay(job.backoff, job.attempt);
        this.logger.warn(`${job.queue}/${job.name} #${job.id} attempt ${job.attempt} failed: ${message}; retry in ${delay}ms`);
        job.attempt += 1;
        job.status = 'delayed';
        this.schedule(job, delay);
      } else {
        this.logger.error(`${job.queue}/${job.name} #${job.id} failed after ${job.attempt} attempt(s): ${message}`);
        this.finish(job, 'failed');
      }
    }
  }

  private finish(job: MemoryJob, status: 'completed' | 'failed'): void {
    job.status = status;
    job.finishedAt = Date.now();
    if (status === 'completed') job.failedReason = undefined;
    // Keep the newest MEMORY_KEEP_FINISHED jobs of this queue and state.
    const same = [...this.memoryJobs].filter(([, j]) => j.queue === job.queue && j.status === status);
    for (const [key] of same.slice(0, Math.max(0, same.length - MEMORY_KEEP_FINISHED))) this.memoryJobs.delete(key);
  }

  private memoryCounts(queue: string): QueueCounts {
    const counts: QueueCounts = {
      name: queue,
      waiting: 0,
      active: 0,
      delayed: 0,
      completed: 0,
      failed: 0,
      paused: this.pausedQueues.has(queue),
    };
    for (const job of this.memoryJobs.values()) if (job.queue === queue) counts[job.status] += 1;
    return counts;
  }

  private memoryInfo(job: MemoryJob): JobInfo {
    const iso = (ms?: number) => (ms === undefined ? null : new Date(ms).toISOString());
    return {
      id: job.id,
      name: job.name,
      queue: job.queue,
      status: job.status,
      data: redactJobData(job.data),
      attemptsMade: job.status === 'waiting' || job.status === 'delayed' ? job.attempt - 1 : job.attempt,
      attempts: job.attempts,
      failedReason: job.failedReason ?? null,
      createdAt: iso(job.createdAt),
      processedAt: iso(job.processedAt),
      finishedAt: iso(job.finishedAt),
    };
  }
}
