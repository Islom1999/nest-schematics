import { ConfigService } from '@nestjs/config';
import { join, resolve } from 'path';
import { readMediaSettings } from '../media.settings';

/** Resumable upload (tus) settings from env; every key is optional. */
export interface TusSettings {
  /**
   * TUS_DIR (absolute): where unfinished uploads live (default UPLOAD_DIR/.tus).
   * With tusd it is the folder the api sees tusd's `-upload-dir` volume at.
   */
  dir: string;
  /** TUS_EXPIRE_HOURS: unfinished uploads untouched this long are deleted (0 = never). */
  expireHours: number;
  /** TUS_HOOK_SECRET (tusd): value of the X-Tus-Hook-Secret header; empty = hooks only from private networks. */
  hookSecret: string;
}

/** Header that carries TUS_HOOK_SECRET on tusd hook requests. */
export const TUS_HOOK_SECRET_HEADER = 'x-tus-hook-secret';

/** Response header with the media_files id when an upload finishes (node engine). */
export const TUS_MEDIA_ID_HEADER = 'Upload-Media-Id';

function text(config: ConfigService, key: string): string {
  const value = config.get<string | number | boolean>(key);
  return value === undefined || value === null ? '' : String(value).trim();
}

export function readTusSettings(config: ConfigService): TusSettings {
  const raw = text(config, 'TUS_EXPIRE_HOURS');
  const hours = Number(raw);
  return {
    dir: resolve(text(config, 'TUS_DIR') || join(readMediaSettings(config).dir, '.tus')),
    expireHours: raw === '' || !Number.isFinite(hours) || hours < 0 ? 24 : hours,
    hookSecret: text(config, 'TUS_HOOK_SECRET'),
  };
}
