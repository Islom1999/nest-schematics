import type { Readable } from 'stream';
import { MediaStorage } from '@app/database';
import { ByteRange } from '../http-range';

/** Bytes to store: a buffer, or a file on disk (`move`: it may be moved instead of copied). */
export type StorageSource = Buffer | { path: string; move?: boolean };

export interface StoredObjectStat {
  size: number;
  modifiedAt?: Date;
}

/**
 * Where file bytes live. Keys look like `image/general/2025/01/31/<random>.png`
 * and are checked with `assertSafeKey` by every driver.
 */
export interface StorageDriver {
  readonly name: MediaStorage;
  put(key: string, source: StorageSource, contentType: string): Promise<void>;
  /** The whole object, or the inclusive `range`. */
  getStream(key: string, range?: ByteRange): Promise<Readable>;
  /** null when the object does not exist. */
  stat(key: string): Promise<StoredObjectStat | null>;
  /** No error when the object does not exist. */
  delete(key: string): Promise<void>;
  /** Public URL when the storage serves files itself (e.g. S3_PUBLIC_URL), else null. */
  url?(key: string): string | null;
}

/** Injection tokens of the drivers (MediaStorageService picks one). */
export const LOCAL_STORAGE_DRIVER = 'MEDIA_LOCAL_STORAGE_DRIVER';
export const S3_STORAGE_DRIVER = 'MEDIA_S3_STORAGE_DRIVER';

const SAFE_KEY = /^[a-z0-9][a-z0-9_.-]*(\/[a-z0-9][a-z0-9_.-]*)*$/i;

/** Refuses keys that could leave the storage root (`..`, absolute paths, backslashes, dot folders). */
export function assertSafeKey(key: string): void {
  if (key.length > 512 || !SAFE_KEY.test(key) || key.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
  }
}

export function isNotFoundError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
