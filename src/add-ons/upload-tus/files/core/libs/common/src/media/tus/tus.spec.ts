import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { MediaKind } from '@app/database';
import { readMediaSettings } from '../media.settings';
import {
  checkTusCreate,
  declaredKind,
  isTusUploadId,
  purgeExpiredTusUploads,
  readTusResult,
  readTusSettings,
  removeTusUpload,
  tusUploadExists,
  writeTusResult,
} from './index';

const settings = readMediaSettings(new ConfigService({ UPLOAD_MAX_IMAGE_MB: '1', UPLOAD_ALLOWED_KINDS: 'image,pdf' }));

function status(fn: () => unknown): number | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : -1;
  }
}

describe('tus limits', () => {
  it('guesses the kind from filetype, then from the file name', () => {
    expect(declaredKind({ filetype: 'image/png' })).toBe(MediaKind.IMAGE);
    expect(declaredKind({ filetype: 'video/x-m4v' })).toBe(MediaKind.VIDEO);
    expect(declaredKind({ filetype: 'application/octet-stream', filename: 'scan.PDF' })).toBe(MediaKind.PDF);
    expect(declaredKind({ filename: 'notes' })).toBeNull();
    expect(status(() => declaredKind({ filetype: 'image/svg+xml' }))).toBe(415);
    expect(status(() => declaredKind({ filetype: 'text/html' }))).toBe(415);
  });

  it('checks Upload-Length, usage, kind and the per-kind limit', () => {
    expect(checkTusCreate(settings, { size: 1024, metadata: { filetype: 'image/png' } })).toEqual({
      kind: MediaKind.IMAGE,
      maxBytes: 1024 * 1024,
    });
    expect(status(() => checkTusCreate(settings, { size: 2 * 1024 * 1024, metadata: { filetype: 'image/png' } }))).toBe(413);
    expect(status(() => checkTusCreate(settings, { size: 10, metadata: { filetype: 'video/mp4' } }))).toBe(415);
    expect(status(() => checkTusCreate(settings, { size: null, deferred: true }))).toBe(400);
    expect(status(() => checkTusCreate(settings, { size: 0 }))).toBe(400);
    expect(status(() => checkTusCreate(settings, { size: 10, metadata: { usage: '../etc' } }))).toBe(400);
    // Unknown kind: the largest allowed limit (pdf 20 MB) applies until the bytes are checked.
    expect(checkTusCreate(settings, { size: 5 * 1024 * 1024, metadata: {} }).maxBytes).toBe(20 * 1024 * 1024);
  });
});

describe('tus folder', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tus-spec-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads TUS_DIR / TUS_EXPIRE_HOURS with defaults', () => {
    const defaults = readTusSettings(new ConfigService({ UPLOAD_DIR: dir }));
    expect(defaults).toEqual({ dir: join(dir, '.tus'), expireHours: 24, hookSecret: '' });
    expect(readTusSettings(new ConfigService({ TUS_DIR: dir, TUS_EXPIRE_HOURS: '0' })).expireHours).toBe(0);
  });

  it('refuses ids that could leave the folder', () => {
    expect(isTusUploadId('0f3a9c')).toBe(true);
    for (const id of ['', '..', '../x', 'a/b', '.results', 'x'.repeat(129)]) expect(isTusUploadId(id)).toBe(false);
  });

  it('stores results and removes uploads with their info files', async () => {
    await writeFile(join(dir, 'abc'), 'data');
    await writeFile(join(dir, 'abc.info'), '{}');
    expect(await tusUploadExists(dir, 'abc')).toBe(true);
    await writeTusResult(dir, 'abc', { status: 'done', mediaId: 'm1' });
    expect(await readTusResult(dir, 'abc')).toMatchObject({ status: 'done', mediaId: 'm1' });
    expect(await readTusResult(dir, 'other')).toBeNull();
    await removeTusUpload(dir, 'abc');
    expect(await tusUploadExists(dir, 'abc')).toBe(false);
    expect((await readdir(dir)).sort()).toEqual(['.results']);
  });

  it('purges uploads untouched for the expiry window, keeps recent ones', async () => {
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    await writeFile(join(dir, 'stale'), 'x');
    await writeFile(join(dir, 'stale.json'), '{}');
    await utimes(join(dir, 'stale'), old, old);
    await utimes(join(dir, 'stale.json'), old, old);
    await writeFile(join(dir, 'fresh'), 'x');
    await writeFile(join(dir, 'fresh.json'), '{}');
    await utimes(join(dir, 'fresh.json'), old, old);
    await writeTusResult(dir, 'gone', { status: 'failed', statusCode: 415, message: 'no' });
    await utimes(join(dir, '.results', 'gone.json'), old, old);

    expect(await purgeExpiredTusUploads(dir, 24)).toBe(1);
    expect((await readdir(dir)).sort()).toEqual(['.results', 'fresh', 'fresh.json']);
    expect(await readTusResult(dir, 'gone')).toBeNull();
    expect(await purgeExpiredTusUploads(dir, 0)).toBe(0);
    expect(await purgeExpiredTusUploads(join(dir, 'missing'), 24)).toBe(0);
  });
});
