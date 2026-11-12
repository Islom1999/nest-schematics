import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { constants, createReadStream } from 'fs';
import { copyFile, mkdir, rename, stat, unlink, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import type { Readable } from 'stream';
import { MediaStorage } from '@app/database';
import { ByteRange } from '../http-range';
import { readMediaSettings } from '../media.settings';
import { assertSafeKey, isNotFoundError, StorageDriver, StorageSource, StoredObjectStat } from './storage-driver';

/** Files under UPLOAD_DIR (default ./uploads). Keys never leave that folder. */
@Injectable()
export class LocalStorageDriver implements StorageDriver {
  readonly name = MediaStorage.LOCAL;
  readonly root: string;

  constructor(config: ConfigService) {
    this.root = readMediaSettings(config).dir;
  }

  /** Absolute path of a key, refused when it would leave the root. */
  resolve(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
    return full;
  }

  async put(key: string, source: StorageSource, _contentType: string): Promise<void> {
    const target = this.resolve(key);
    await mkdir(dirname(target), { recursive: true });
    if (Buffer.isBuffer(source)) {
      await writeFile(target, source, { flag: 'wx' });
      return;
    }
    if (source.move) {
      try {
        await rename(source.path, target);
        return;
      } catch (error) {
        // Another device (e.g. UPLOAD_TMP_DIR elsewhere): copy instead.
        if ((error as { code?: string }).code !== 'EXDEV') throw error;
      }
    }
    await copyFile(source.path, target, constants.COPYFILE_EXCL);
  }

  async getStream(key: string, range?: ByteRange): Promise<Readable> {
    return createReadStream(this.resolve(key), range ? { start: range.start, end: range.end } : {});
  }

  async stat(key: string): Promise<StoredObjectStat | null> {
    try {
      const info = await stat(this.resolve(key));
      return info.isFile() ? { size: info.size, modifiedAt: info.mtime } : null;
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
}
