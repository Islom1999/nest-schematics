import { ConfigService } from '@nestjs/config';
import { join, resolve } from 'path';
import { MediaKind } from '@app/database';

const MB = 1024 * 1024;

/** Default per-kind size limits in MB (UPLOAD_MAX_<KIND>_MB overrides them). */
export const DEFAULT_MAX_MB: Record<MediaKind, number> = {
  [MediaKind.IMAGE]: 10,
  [MediaKind.VIDEO]: 500,
  [MediaKind.AUDIO]: 50,
  [MediaKind.PDF]: 20,
  [MediaKind.OTHER]: 20,
};

/** Upload settings from env; every key is optional. */
export interface MediaSettings {
  /** UPLOAD_STORAGE: `local`, `s3`, or empty = s3 when installed and S3_BUCKET is set, else local. */
  storage: string;
  /** UPLOAD_DIR (absolute): root of the local driver. */
  dir: string;
  /** UPLOAD_TMP_DIR (absolute): where multer writes incoming files before they are checked. */
  tmpDir: string;
  /** UPLOAD_PUBLIC_URL: base of the `url` in responses (default `/api/files`). */
  publicUrl: string;
  /** UPLOAD_MAX_FILES: files per request. */
  maxFiles: number;
  /** Per-kind limit in bytes. */
  maxBytes: Record<MediaKind, number>;
  /** UPLOAD_ALLOWED_KINDS: kinds accepted at all. */
  allowedKinds: MediaKind[];
  /** UPLOAD_ORPHAN_HOURS: unused files older than this are deleted (0 = never). */
  orphanHours: number;
  /** UPLOAD_CACHE_MAX_AGE: Cache-Control max-age (seconds) of `GET files/:id`. */
  cacheMaxAge: number;
  /** UPLOAD_THUMBNAIL_WIDTH: thumbnail box in pixels (with thumbnails). */
  thumbnailWidth: number;
}

function text(config: ConfigService, key: string): string {
  const value = config.get<string | number | boolean>(key);
  return value === undefined || value === null ? '' : String(value).trim();
}

function positive(config: ConfigService, key: string, fallback: number): number {
  const raw = text(config, key);
  const value = Number(raw);
  return raw === '' || !Number.isFinite(value) || value < 0 ? fallback : value;
}

export function readMediaSettings(config: ConfigService): MediaSettings {
  const dir = resolve(text(config, 'UPLOAD_DIR') || './uploads');
  const kinds = Object.values(MediaKind);
  const allowed = text(config, 'UPLOAD_ALLOWED_KINDS')
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter((k): k is MediaKind => (kinds as string[]).includes(k));
  const maxBytes = {} as Record<MediaKind, number>;
  for (const kind of kinds) {
    const mb = positive(config, `UPLOAD_MAX_${kind.toUpperCase()}_MB`, DEFAULT_MAX_MB[kind]);
    maxBytes[kind] = Math.round((mb || DEFAULT_MAX_MB[kind]) * MB);
  }
  return {
    storage: text(config, 'UPLOAD_STORAGE').toLowerCase(),
    dir,
    tmpDir: resolve(text(config, 'UPLOAD_TMP_DIR') || join(dir, '.tmp')),
    publicUrl: (text(config, 'UPLOAD_PUBLIC_URL') || '/api/files').replace(/\/+$/, ''),
    maxFiles: Math.max(1, Math.floor(positive(config, 'UPLOAD_MAX_FILES', 10))),
    maxBytes,
    allowedKinds: allowed.length ? allowed : kinds,
    orphanHours: positive(config, 'UPLOAD_ORPHAN_HOURS', 24),
    cacheMaxAge: Math.floor(positive(config, 'UPLOAD_CACHE_MAX_AGE', 604800)),
    thumbnailWidth: Math.max(16, Math.floor(positive(config, 'UPLOAD_THUMBNAIL_WIDTH', 320))),
  };
}

/** `10485760` → `10 MB`. */
export function formatBytes(bytes: number): string {
  return bytes >= MB ? `${Math.round((bytes / MB) * 10) / 10} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
