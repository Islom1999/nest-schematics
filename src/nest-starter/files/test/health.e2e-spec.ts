import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { ApiModule } from '../apps/api/src/api.module';

/** Boots the whole api against the database in `.env` (`npm run test:e2e`). */
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health reports the database and memory', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' }, memory_heap: { status: 'up' } },
    });
  });

  it('GET /api/health/live answers without a token', async () => {
    await request(app.getHttpServer()).get('/api/health/live').expect(200);
  });

  it('GET /api/health/ready checks the database', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', info: { database: { status: 'up' } } });
  });
});
