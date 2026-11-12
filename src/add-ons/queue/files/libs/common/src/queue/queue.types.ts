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
  /** Workers take no new jobs until `resume()`. */
  paused: boolean;
}

/** Job states `listJobs()` can filter by. */
export const JOB_STATUSES = ['waiting', 'active', 'delayed', 'completed', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** States `clean()` can remove (never `active`). */
export const CLEANABLE_STATUSES = ['completed', 'failed', 'delayed', 'waiting'] as const;
export type CleanableStatus = (typeof CLEANABLE_STATUSES)[number];

/** One job as the admin panel sees it. `data` has secret-looking keys masked. */
export interface JobInfo {
  id: string;
  name: string;
  queue: string;
  status: JobStatus;
  data: unknown;
  /** Runs started so far. */
  attemptsMade: number;
  /** Runs allowed (including the first), null when unknown. */
  attempts: number | null;
  failedReason: string | null;
  /** ISO dates; null when the job has not reached that point. */
  createdAt: string | null;
  processedAt: string | null;
  finishedAt: string | null;
}

export interface JobPage {
  /** Jobs in that state in total, for the pager. */
  count: number;
  data: JobInfo[];
}

const SECRET_KEY = /pass|secret|token|otp|code|authorization|api[-_]?key|cookie/i;
const MAX_TEXT = 500;

/**
 * Job data for the admin panel: values of keys that look secret (password,
 * token, otp, code...) become `***`, long strings are cut, depth is limited.
 */
export function redactJobData(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}...` : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactJobData(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) && v != null ? '***' : redactJobData(v, depth + 1);
  }
  return out;
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
export function jobRetryDelay(backoff: number | BackoffOptions | undefined, attempt: number): number {
  if (backoff === undefined) return 0;
  if (typeof backoff === 'number') return backoff;
  const delay = backoff.delay ?? 0;
  return backoff.type === 'exponential' ? delay * 2 ** (attempt - 1) : delay;
}
