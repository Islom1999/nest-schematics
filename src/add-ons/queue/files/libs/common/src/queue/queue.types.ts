import type { BackoffOptions, JobsOptions } from 'bullmq';

/** The queue a job goes to when `enqueue()` names none. */
export const DEFAULT_QUEUE = 'default';

/** Every job: 3 attempts, exponential backoff 1s → 2s → 4s, finished jobs trimmed. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/** `enqueue()` options: BullMQ job options (attempts, backoff, delay, jobId, priority...) plus the queue. */
export interface EnqueueOptions extends JobsOptions {
  /** Queue name (default `default`). Must match the queue of the `@JobHandler`. */
  queue?: string;
}

export interface EnqueuedJob {
  id: string;
  name: string;
  queue: string;
}

/** What a handler gets besides the job data. */
export interface JobContext<T = unknown> {
  id: string;
  name: string;
  queue: string;
  data: T;
  /** 1 on the first run, 2 on the first retry... */
  attempt: number;
}

export type QueueDriver = 'redis' | 'memory';

export interface QueueCounts {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

export interface QueueModuleOptions {
  /**
   * Run `@JobHandler`s in this process (BullMQ workers). Default true. The api
   * sets `false` once apps/worker exists; the worker then consumes the jobs.
   * Ignored by the in-memory driver: its jobs always run in the process that
   * enqueued them.
   */
  processors?: boolean;
  /** Extra queues to register besides `default` (same as `QueueModule.forFeature`). */
  queues?: string[];
}

/** Delay before retry number `attempt` (1-based) for BullMQ-style backoff options. */
export function backoffDelay(backoff: number | BackoffOptions | undefined, attempt: number): number {
  if (backoff === undefined) return 0;
  if (typeof backoff === 'number') return backoff;
  const delay = backoff.delay ?? 0;
  return backoff.type === 'exponential' ? delay * 2 ** (attempt - 1) : delay;
}
