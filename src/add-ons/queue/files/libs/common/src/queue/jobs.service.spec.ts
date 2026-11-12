import { Injectable } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { JobHandler } from './job-handler.decorator';
import { JobsService } from './jobs.service';
import { QueueModule } from './queue.module';
import { jobRetryDelay, DEFAULT_JOB_OPTIONS, JobContext } from './queue.types';

/** A BullMQ job as far as JobsService reads it. */
function mockBullJob(id: string, state: string) {
  return {
    id,
    name: 'mail.send',
    data: { to: 'a@b.c', password: 'hunter2' },
    attemptsMade: 3,
    opts: { attempts: 3 },
    failedReason: 'SMTP down',
    timestamp: 1_700_000_000_000,
    processedOn: 1_700_000_001_000,
    finishedOn: 1_700_000_002_000,
    getState: jest.fn(() => Promise.resolve(state)),
    retry: jest.fn(() => Promise.resolve()),
  };
}

jest.mock('bullmq', () => {
  const actual = jest.requireActual<typeof import('bullmq')>('bullmq');
  // No Redis here: Queue/Worker are replaced by stubs that record their calls.
  class Queue {
    static instances: Queue[] = [];
    add = jest.fn((name: string) => Promise.resolve({ id: '42', name }));
    getJobCounts = jest.fn(() => Promise.resolve({ waiting: 1, active: 0, delayed: 2, completed: 3, failed: 4 }));
    isPaused = jest.fn(() => Promise.resolve(false));
    getJobCountByTypes = jest.fn(() => Promise.resolve(2));
    stored: Record<string, ReturnType<typeof mockBullJob>> = { '9': mockBullJob('9', 'failed'), '10': mockBullJob('10', 'active') };
    getJobs = jest.fn(() => Promise.resolve([this.stored['9'], null]));
    getJob = jest.fn((id: string) => Promise.resolve(this.stored[id]));
    clean = jest.fn(() => Promise.resolve(['1', '2', '3']));
    pause = jest.fn(() => Promise.resolve());
    resume = jest.fn(() => Promise.resolve());
    close = jest.fn(() => Promise.resolve());
    constructor(
      readonly name: string,
      readonly opts: unknown,
    ) {
      Queue.instances.push(this);
    }
  }
  class Worker {
    static instances: Worker[] = [];
    on = jest.fn();
    close = jest.fn(() => Promise.resolve());
    constructor(
      readonly name: string,
      readonly processor: (job: unknown) => Promise<unknown>,
      readonly opts: { concurrency: number },
    ) {
      Worker.instances.push(this);
    }
  }
  return { ...actual, Queue, Worker };
});

interface QueueStub {
  name: string;
  add: jest.Mock;
  opts: unknown;
}
const QueueStubs = Queue as unknown as { instances: QueueStub[] };

const calls: { data: unknown; job: JobContext }[] = [];
let failuresLeft = 0;

@Injectable()
class MailJobs {
  @JobHandler('mail.send')
  async send(data: unknown, job: JobContext) {
    calls.push({ data, job });
    if (failuresLeft-- > 0) throw new Error('SMTP down');
  }
}

async function start(env: Record<string, string>, processors = true) {
  const saved = process.env.REDIS_URL;
  if (env.REDIS_URL) process.env.REDIS_URL = env.REDIS_URL;
  else delete process.env.REDIS_URL;
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }), QueueModule.forRoot({ processors })],
      providers: [MailJobs],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    return app;
  } finally {
    if (saved === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = saved;
  }
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls instead of sleeping a fixed time: the machine may be busy running other test files. */
async function until(condition: () => Promise<boolean> | boolean, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error('until(): condition not met in time');
    await tick(5);
  }
}

describe('JobsService', () => {
  beforeEach(() => {
    calls.length = 0;
    failuresLeft = 0;
    QueueStubs.instances.length = 0;
  });

  it('defaults to 3 attempts with exponential backoff', () => {
    expect(DEFAULT_JOB_OPTIONS).toMatchObject({ attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
    expect([1, 2, 3].map((n) => jobRetryDelay({ type: 'exponential', delay: 1000 }, n))).toEqual([1000, 2000, 4000]);
    expect(jobRetryDelay({ type: 'fixed', delay: 500 }, 3)).toBe(500);
  });

  describe('without REDIS_URL (memory driver)', () => {
    it('runs the handler in process and retries with backoff', async () => {
      const app = await start({});
      const jobs = app.get(JobsService);
      expect(jobs.driver).toBe('memory');
      failuresLeft = 1;
      const job = await jobs.enqueue('mail.send', { to: 'a@b.c' }, { backoff: { type: 'exponential', delay: 5 } });
      expect(job).toEqual({ id: expect.any(String) as string, name: 'mail.send', queue: 'default' });
      await until(async () => (await jobs.stats())[0].completed === 1);
      expect(calls.map((c) => c.job.attempt)).toEqual([1, 2]);
      expect(calls[1].data).toEqual({ to: 'a@b.c' });
      expect(await jobs.stats()).toEqual([
        { name: 'default', waiting: 0, active: 0, delayed: 0, completed: 1, failed: 0, paused: false },
      ]);
      expect(QueueStubs.instances).toHaveLength(0);
      await app.close();
    });

    it('fails a job after its attempts and one without a handler at once', async () => {
      const app = await start({});
      const jobs = app.get(JobsService);
      failuresLeft = 5;
      await jobs.enqueue('mail.send', {}, { attempts: 2, backoff: 1 });
      await jobs.enqueue('unknown.job', {});
      await until(async () => (await jobs.stats())[0].failed === 2);
      expect(calls).toHaveLength(2);
      expect((await jobs.stats())[0]).toMatchObject({ completed: 0, failed: 2 });
      await app.close();
    });
  });

  describe('admin operations, memory driver', () => {
    it('lists jobs by state with paging, newest first, and masks secrets', async () => {
      const app = await start({});
      const jobs = app.get(JobsService);
      failuresLeft = 99;
      for (const n of [1, 2, 3]) await jobs.enqueue('mail.send', { n, password: 'hunter2', nested: { otpCode: '123456' } }, { attempts: 1 });
      await jobs.enqueue('mail.send', { later: true }, { delay: 60_000 });
      await until(async () => (await jobs.stats())[0].failed === 3);
      const failed = await jobs.listJobs('default', 'failed', 1, 2);
      expect(failed.count).toBe(3);
      expect(failed.data).toHaveLength(2);
      expect(failed.data[0]).toMatchObject({
        name: 'mail.send',
        queue: 'default',
        status: 'failed',
        attemptsMade: 1,
        attempts: 1,
        failedReason: 'SMTP down',
        data: { n: 3, password: '***', nested: { otpCode: '***' } },
      });
      expect((await jobs.listJobs('default', 'failed', 2, 2)).data).toHaveLength(1);
      expect((await jobs.listJobs('default', 'delayed')).count).toBe(1);
      await expect(jobs.listJobs('nope', 'failed')).rejects.toThrow('Queue "nope" not found');
      await app.close();
    });

    it('retries a failed job from its first attempt; 404 and 409 otherwise', async () => {
      const app = await start({});
      const jobs = app.get(JobsService);
      failuresLeft = 1;
      const job = await jobs.enqueue('mail.send', { to: 'x' }, { attempts: 1 });
      await until(async () => (await jobs.stats())[0].failed === 1);
      expect((await jobs.stats())[0]).toMatchObject({ failed: 1, completed: 0 });
      await jobs.retryJob('default', job.id);
      await until(async () => (await jobs.stats())[0].completed === 1);
      expect(calls.map((c) => c.job.attempt)).toEqual([1, 1]);
      expect((await jobs.stats())[0]).toMatchObject({ failed: 0, completed: 1 });
      await expect(jobs.retryJob('default', job.id)).rejects.toThrow(/only failed jobs can be retried/);
      await expect(jobs.retryJob('default', 'missing')).rejects.toThrow('not found');
      await app.close();
    });

    it('cleans finished jobs older than the grace period and leaves the rest', async () => {
      const app = await start({});
      const jobs = app.get(JobsService);
      await jobs.enqueue('mail.send', {});
      await until(async () => (await jobs.stats())[0].completed === 1);
      expect(await jobs.clean('default', 'completed', 60_000)).toBe(0);
      expect(await jobs.clean('default', 'failed', 0)).toBe(0);
      expect(await jobs.clean('default', 'completed', 0)).toBe(1);
      expect((await jobs.stats())[0]).toMatchObject({ completed: 0 });
      await app.close();
    });

    it('pause holds due jobs, resume runs them', async () => {
      const app = await start({});
      const jobs = app.get(JobsService);
      await jobs.pauseQueue('default');
      expect((await jobs.stats())[0].paused).toBe(true);
      await jobs.enqueue('mail.send', { a: 1 });
      await tick(20);
      expect(calls).toHaveLength(0);
      expect((await jobs.stats())[0]).toMatchObject({ waiting: 1, paused: true });
      await jobs.resumeQueue('default');
      await until(async () => (await jobs.stats())[0].completed === 1);
      expect(calls).toHaveLength(1);
      expect((await jobs.stats())[0]).toMatchObject({ waiting: 0, completed: 1, paused: false });
      await app.close();
    });
  });

  describe('with REDIS_URL (BullMQ driver, stubbed)', () => {
    it('adds jobs with the default retry options to BullMQ', async () => {
      const app = await start({ REDIS_URL: 'redis://localhost:6379/1' });
      const jobs = app.get(JobsService);
      expect(jobs.driver).toBe('redis');
      const job = await jobs.enqueue('mail.send', { to: 'x' }, { delay: 1000 });
      expect(job).toEqual({ id: '42', name: 'mail.send', queue: 'default' });
      const queue = QueueStubs.instances.find((q) => q.add.mock.calls.length)!;
      expect(queue.add).toHaveBeenCalledWith('mail.send', { to: 'x' }, { ...DEFAULT_JOB_OPTIONS, delay: 1000 });
      expect(queue.opts).toMatchObject({ connection: { host: 'localhost', port: 6379, db: 1 } });
      expect((await jobs.stats())[0]).toEqual({ name: 'default', waiting: 1, active: 0, delayed: 2, completed: 3, failed: 4, paused: false });
      await app.close();
    });

    it('lists, retries, cleans, pauses and resumes through the BullMQ API', async () => {
      const app = await start({ REDIS_URL: 'redis://localhost:6379' });
      const jobs = app.get(JobsService);
      // The stub the service picked is the one that got the call.
      type Method = 'getJobs' | 'getJob' | 'clean' | 'pause' | 'resume';
      type Stub = Record<Method, jest.Mock> & { stored: Record<string, { retry: jest.Mock }> };
      const used = (method: Method) => (QueueStubs.instances as unknown as Stub[]).find((q) => q[method].mock.calls.length)!;

      const page = await jobs.listJobs('default', 'failed', 2, 10);
      expect(used('getJobs').getJobs).toHaveBeenCalledWith(['failed'], 10, 19, false);
      expect(page.count).toBe(2);
      expect(page.data).toEqual([
        {
          id: '9',
          name: 'mail.send',
          queue: 'default',
          status: 'failed',
          data: { to: 'a@b.c', password: '***' },
          attemptsMade: 3,
          attempts: 3,
          failedReason: 'SMTP down',
          createdAt: '2023-11-14T22:13:20.000Z',
          processedAt: '2023-11-14T22:13:21.000Z',
          finishedAt: '2023-11-14T22:13:22.000Z',
        },
      ]);

      await jobs.retryJob('default', '9');
      expect(used('getJob').stored['9'].retry).toHaveBeenCalledWith('failed', { resetAttemptsMade: true });
      await expect(jobs.retryJob('default', '10')).rejects.toThrow(/is active, only failed jobs/);
      await expect(jobs.retryJob('default', '404')).rejects.toThrow('not found');

      expect(await jobs.clean('default', 'waiting', 5000)).toBe(3);
      expect(used('clean').clean).toHaveBeenCalledWith(5000, 0, 'wait');
      await jobs.clean('default', 'failed', 0);
      expect(used('clean').clean).toHaveBeenLastCalledWith(0, 0, 'failed');

      await jobs.pauseQueue('default');
      await jobs.resumeQueue('default');
      expect(used('pause').pause).toHaveBeenCalledTimes(1);
      expect(used('resume').resume).toHaveBeenCalledTimes(1);
      await expect(jobs.pauseQueue('unknown')).rejects.toThrow('not found');
      await app.close();
    });

    it('starts a worker that dispatches by job name, unless processors are off', async () => {
      const { Worker } = jest.requireMock<{ Worker: { instances: { processor: (job: unknown) => Promise<unknown> }[] } }>(
        'bullmq',
      );
      Worker.instances.length = 0;
      const app = await start({ REDIS_URL: 'redis://localhost:6379' });
      expect(Worker.instances).toHaveLength(1);
      await Worker.instances[0].processor({ id: '7', name: 'mail.send', data: { to: 'y' }, attemptsMade: 1 });
      expect(calls[0].job).toMatchObject({ id: '7', queue: 'default', attempt: 2 });
      await expect(Worker.instances[0].processor({ id: '8', name: 'nope', data: {}, attemptsMade: 0 })).rejects.toThrow(
        "No @JobHandler('nope')",
      );
      await app.close();

      Worker.instances.length = 0;
      const api = await start({ REDIS_URL: 'redis://localhost:6379' }, false);
      expect(Worker.instances).toHaveLength(0);
      await api.close();
    });
  });
});
