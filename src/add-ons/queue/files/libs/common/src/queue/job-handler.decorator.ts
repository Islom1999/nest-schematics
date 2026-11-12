import { SetMetadata } from '@nestjs/common';
import { DEFAULT_QUEUE } from './queue.types';

export const JOB_HANDLER_METADATA = 'queue:job-handler';

export interface JobHandlerOptions {
  /** Queue the job is enqueued to (default `default`). */
  queue?: string;
  /** Parallel jobs of this queue per process (the highest value of a queue wins). Default 1. */
  concurrency?: number;
}

export interface JobHandlerMetadata {
  name: string;
  queue: string;
  concurrency: number;
}

/**
 * Marks a provider method as the handler of job `name`:
 *
 *   @Injectable()
 *   export class MailJobs {
 *     @JobHandler('mail.send')
 *     async send(data: SendMailJob, job: JobContext<SendMailJob>) { ... }
 *   }
 *
 * and anywhere: `await jobs.enqueue('mail.send', { to, subject })`.
 * A thrown error fails the attempt; it is retried with backoff until
 * `attempts` (default 3) are used up. The provider must be part of the app
 * that runs processors (apps/worker when it is installed).
 */
export function JobHandler(name: string, options: JobHandlerOptions = {}): MethodDecorator {
  const metadata: JobHandlerMetadata = {
    name,
    queue: options.queue ?? DEFAULT_QUEUE,
    concurrency: Math.max(1, options.concurrency ?? 1),
  };
  return SetMetadata(JOB_HANDLER_METADATA, metadata);
}
