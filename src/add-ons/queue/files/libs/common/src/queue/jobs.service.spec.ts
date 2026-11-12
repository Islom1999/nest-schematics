import { Injectable } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { JobHandler } from './job-handler.decorator';
import { JobsService } from './jobs.service';
import { QueueModule } from './queue.module';
import { jobRetryDelay, DEFAULT_JOB_OPTIONS, JobContext } from './queue.types';

jest.mock('bullmq', () => {
  const actual = jest.requireActual<typeof import('bullmq')>('bullmq');
  // No Redis here: Queue/Worker are replaced by stubs that record their calls.
  class Queue {
    static instances: Queue[] = [];
    add = jest.fn((name: string) => Promise.resolve({ id: '42', name }));
    getJobCounts = jest.fn(() => Promise.resolve({ waiting: 1, active: 0, delayed: 2, completed: 3, failed: 4 }));
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
      await tick(60);
      expect(calls.map((c) => c.job.attempt)).toEqual([1, 2]);
      expect(calls[1].data).toEqual({ to: 'a@b.c' });
      expect(await jobs.stats()).toEqual([
        { name: 'default', waiting: 0, active: 0, delayed: 0, completed: 1, failed: 0 },
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
      await tick(40);
      expect(calls).toHaveLength(2);
      expect((await jobs.stats())[0]).toMatchObject({ completed: 0, failed: 2 });
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
      expect((await jobs.stats())[0]).toEqual({ name: 'default', waiting: 1, active: 0, delayed: 2, completed: 3, failed: 4 });
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
