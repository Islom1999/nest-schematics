import { INestApplication, PayloadTooLargeException, UnauthorizedException, UnsupportedMediaTypeException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { MediaUploaderType } from '@app/database';
import { TusAuthService } from './tus-auth.service';
import { TusHooksController } from './tus-hooks.controller';
import { isPrivateAddress, secretsMatch, TusHooksService } from './tus-hooks.service';
import { TusUploadsService } from './tus-uploads.service';

/** tusd v2 hook body, as `-hooks-http` posts it. */
function hook(type: string, upload: Record<string, unknown>, headers: Record<string, string[]> = {}) {
  return {
    Type: type,
    Event: {
      Upload: { ID: '', Size: 10, SizeIsDeferred: false, Offset: 0, MetaData: { filename: 'a.png', filetype: 'image/png' }, ...upload },
      HTTPRequest: { Method: 'POST', URI: '/files/', RemoteAddr: '203.0.113.7:5000', Header: headers },
    },
  };
}

describe('TusHooksController (tusd hooks, mocked requests)', () => {
  let app: INestApplication<App>;
  const settings = { dir: '/tmp/tus', expireHours: 24, hookSecret: '' };
  const uploads = {
    settings,
    checkCreate: jest.fn(),
    withUploader: jest.fn((meta: Record<string, string>, who: { type: string; id: string }) => ({
      ...meta,
      uploaderType: who.type,
      uploaderId: who.id,
    })),
    complete: jest.fn(),
  };
  const auth = { authenticate: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TusHooksController],
      providers: [
        TusHooksService,
        { provide: TusUploadsService, useValue: uploads },
        { provide: TusAuthService, useValue: auth },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    settings.hookSecret = '';
  });

  const post = (body: unknown, secret?: string) => {
    const req = request(app.getHttpServer()).post('/api/internal/tus-hooks').send(body as object);
    return secret === undefined ? req : req.set('X-Tus-Hook-Secret', secret);
  };

  it('pre-create: verifies the forwarded token and limits, pins the uploader into the metadata', async () => {
    auth.authenticate.mockResolvedValue({ type: MediaUploaderType.ADMIN, id: 'admin-1' });
    const res = await post(hook('pre-create', {}, { Authorization: ['Bearer token'] }))
      .expect(200)
      .expect('Content-Type', /application\/json/);
    expect(auth.authenticate).toHaveBeenCalledWith('Bearer token');
    expect(uploads.checkCreate).toHaveBeenCalledWith({
      size: 10,
      deferred: false,
      metadata: { filename: 'a.png', filetype: 'image/png' },
    });
    expect(res.body).toEqual({
      ChangeFileInfo: { MetaData: { filename: 'a.png', filetype: 'image/png', uploaderType: 'admin', uploaderId: 'admin-1' } },
    });
  });

  it('pre-create: rejects anonymous, oversize, wrong-type and concatenated uploads', async () => {
    auth.authenticate.mockRejectedValueOnce(new UnauthorizedException('Missing bearer token'));
    let res = await post(hook('pre-create', {})).expect(200);
    expect(res.body).toMatchObject({ RejectUpload: true, HTTPResponse: { StatusCode: 401 } });

    auth.authenticate.mockResolvedValue({ type: MediaUploaderType.USER, id: 'user-1' });
    uploads.checkCreate.mockImplementationOnce(() => {
      throw new PayloadTooLargeException('image files are limited to 10 MB');
    });
    res = await post(hook('pre-create', { Size: 1e10 }, { Authorization: ['Bearer t'] })).expect(200);
    expect(res.body.RejectUpload).toBe(true);
    expect(res.body.HTTPResponse.StatusCode).toBe(413);
    expect(JSON.parse(String(res.body.HTTPResponse.Body))).toEqual({ statusCode: 413, message: 'image files are limited to 10 MB' });

    uploads.checkCreate.mockImplementationOnce(() => {
      throw new UnsupportedMediaTypeException('text/html: this file type is not allowed');
    });
    res = await post(hook('pre-create', {}, { Authorization: ['Bearer t'] })).expect(200);
    expect(res.body.HTTPResponse.StatusCode).toBe(415);

    res = await post(hook('pre-create', { IsFinal: true }, { Authorization: ['Bearer t'] })).expect(200);
    expect(res.body.HTTPResponse.StatusCode).toBe(400);
  });

  it('post-finish: hands the upload to TusUploadsService and acknowledges', async () => {
    uploads.complete.mockResolvedValue({ id: 'media-1' });
    const meta = { filename: 'a.png', uploaderType: 'admin', uploaderId: 'admin-1' };
    const res = await post(hook('post-finish', { ID: 'abc123', Offset: 10, MetaData: meta })).expect(200);
    expect(res.body).toEqual({});
    expect(uploads.complete).toHaveBeenCalledWith({ id: 'abc123', metadata: meta });

    uploads.complete.mockRejectedValueOnce(new UnsupportedMediaTypeException('a.png: this file type is not allowed'));
    await post(hook('post-finish', { ID: 'abc123' })).expect(200, {});
  });

  it('acknowledges other hook types without doing anything', async () => {
    await post(hook('post-receive', { ID: 'abc123' })).expect(200, {});
    expect(uploads.complete).not.toHaveBeenCalled();
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('requires TUS_HOOK_SECRET when it is set', async () => {
    settings.hookSecret = 'hook-secret-value';
    await post(hook('post-receive', {})).expect(403);
    await post(hook('post-receive', {}), 'wrong').expect(403);
    await post(hook('post-receive', {}), 'hook-secret-value').expect(200, {});
  });

  it('compares secrets in constant time and recognises private addresses', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true);
    expect(secretsMatch('abd', 'abc')).toBe(false);
    expect(secretsMatch(undefined, 'abc')).toBe(false);
    for (const ip of ['127.0.0.1', '::1', '::ffff:10.1.2.3', '172.18.0.5', '192.168.1.10', 'fd00::1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '::ffff:203.0.113.7', '2001:db8::1', undefined]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });
});
