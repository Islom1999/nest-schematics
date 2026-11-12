import { ConfigService } from '@nestjs/config';
import { MediaKind } from '@app/database';
import { detectFileType } from './file-signature';
import { contentDisposition, etagMatches, parseRange } from './http-range';
import { cleanFileName } from './media-files.service';
import { LocalStorageDriver } from './storage/local.storage';
import { assertSafeKey } from './storage/storage-driver';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('detectFileType', () => {
  it('detects types from magic bytes', () => {
    expect(detectFileType(PNG)).toEqual({ mime: 'image/png', ext: 'png', kind: MediaKind.IMAGE });
    expect(detectFileType(Buffer.from('ffd8ffe000104a464946', 'hex'))?.mime).toBe('image/jpeg');
    expect(detectFileType(Buffer.from('%PDF-1.7\n'))?.kind).toBe(MediaKind.PDF);
    expect(detectFileType(Buffer.from('000000206674797069736f6d00000200', 'hex'))?.mime).toBe('video/mp4');
    expect(detectFileType(Buffer.from('ID3\x04\x00'))?.mime).toBe('audio/mpeg');
    expect(detectFileType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 '))?.mime).toBe('image/webp');
  });

  it('refuses text, HTML and SVG whatever the name says', () => {
    expect(detectFileType(Buffer.from('hello, I am not a png'), 'photo.png')).toBeNull();
    expect(detectFileType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'a.svg')).toBeNull();
    expect(detectFileType(Buffer.from('<!doctype html><script>alert(1)</script>'), 'a.html')).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });

  it('uses the name only to tell zip-based office files apart', () => {
    const zip = Buffer.from('504b0304140000000800', 'hex');
    expect(detectFileType(zip, 'report.docx')?.ext).toBe('docx');
    expect(detectFileType(zip, 'report.exe')?.mime).toBe('application/zip');
  });
});

describe('parseRange', () => {
  it('parses single ranges', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-1000', 100)).toEqual({ start: 50, end: 99 });
  });

  it('marks bad or unsatisfiable ranges invalid', () => {
    for (const header of ['bytes=100-', 'bytes=5-1', 'bytes=-0', 'bytes=-', 'items=0-1', 'bytes=0-1,5-6', 'bytes=abc']) {
      expect(parseRange(header, 100)).toBe('invalid');
    }
    expect(parseRange('bytes=0-', 0)).toBe('invalid');
  });
});

describe('http helpers', () => {
  it('matches ETags', () => {
    expect(etagMatches('"a", W/"b"', '"b"')).toBe(true);
    expect(etagMatches('*', '"b"')).toBe(true);
    expect(etagMatches('"c"', '"b"')).toBe(false);
    expect(etagMatches(undefined, '"b"')).toBe(false);
  });

  it('builds a safe Content-Disposition', () => {
    expect(contentDisposition('отчёт "1".pdf', true)).toBe(
      `inline; filename="_____ _1_.pdf"; filename*=UTF-8''${encodeURIComponent('отчёт "1".pdf')}`,
    );
  });

  it('cleans client file names', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('C:\\temp\\a\u0000b.png')).toBe('ab.png');
    expect(cleanFileName(Buffer.from('rasm.png', 'utf8').toString('latin1'))).toBe('rasm.png');
    expect(cleanFileName(Buffer.from('сурат.png', 'utf8').toString('latin1'))).toBe('сурат.png');
    expect(cleanFileName('')).toBe('file');
  });
});

describe('storage keys', () => {
  it('refuses keys that leave the storage root', () => {
    for (const key of ['../x', 'a/../../x', '/etc/passwd', 'a\\b', '.tmp/x', 'a//b', '']) {
      expect(() => assertSafeKey(key)).toThrow();
    }
    expect(() => assertSafeKey('image/general/2025/01/31/abc.png')).not.toThrow();
  });

  it('resolves local keys inside UPLOAD_DIR', () => {
    const driver = new LocalStorageDriver(new ConfigService({ UPLOAD_DIR: '/srv/uploads' }));
    expect(driver.resolve('image/general/a.png')).toBe('/srv/uploads/image/general/a.png');
    expect(() => driver.resolve('../a.png')).toThrow();
  });
});
