import { Inject, Injectable, InternalServerErrorException, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readMediaSettings } from '../media.settings';
import { LOCAL_STORAGE_DRIVER, S3_STORAGE_DRIVER, StorageDriver } from './storage-driver';

/**
 * Picks the driver for new uploads (UPLOAD_STORAGE) and the driver of an
 * existing row (`media_files.storage`), so files stay readable after the
 * default changes. The S3 driver is registered by `npm run g -- upload --storage s3`.
 */
@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);
  /** Driver of new uploads. */
  readonly defaultDriver: StorageDriver;

  constructor(
    config: ConfigService,
    @Inject(LOCAL_STORAGE_DRIVER) private readonly local: StorageDriver,
    @Optional() @Inject(S3_STORAGE_DRIVER) private readonly s3?: StorageDriver | null,
  ) {
    const wanted = readMediaSettings(config).storage;
    const s3Configured = !!this.s3 && !!config.get<string>('S3_BUCKET');
    if (wanted === 's3' && !this.s3) {
      this.logger.warn('UPLOAD_STORAGE=s3, but the S3 driver is not installed (npm run g -- upload --storage s3): using local.');
    }
    const useS3 = wanted === 's3' ? !!this.s3 : wanted === '' && s3Configured;
    this.defaultDriver = useS3 && this.s3 ? this.s3 : this.local;
  }

  /** Driver by name (`media_files.storage`, a MediaStorage value); the default one without a name. */
  driver(name?: string): StorageDriver {
    if (!name) return this.defaultDriver;
    if (name === 'local') return this.local;
    if (name === 's3' && this.s3) return this.s3;
    throw new InternalServerErrorException(`Storage driver "${name}" is not installed`);
  }
}
