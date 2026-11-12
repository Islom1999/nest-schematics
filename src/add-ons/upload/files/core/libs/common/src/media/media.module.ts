import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaFile } from '@app/database';
import { MediaFilesService } from './media-files.service';
import { MediaUsageSubscriber } from './media-usage.subscriber';
import { LocalStorageDriver } from './storage/local.storage';
import { MediaStorageService } from './storage/media-storage.service';
import { LOCAL_STORAGE_DRIVER } from './storage/storage-driver';

/**
 * Media files core (`npm run g -- upload`): storage drivers, MediaFilesService
 * (upload, markUsed/release/findByIds, cleanup) and the subscriber that keeps
 * `used` in sync for entity relations to MediaFile. Global: any module can
 * inject MediaFilesService once the app imports this module.
 * `upload --storage s3` / `--thumbnails` add their providers here.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([MediaFile])],
  providers: [
    { provide: LOCAL_STORAGE_DRIVER, useClass: LocalStorageDriver },
    MediaStorageService,
    MediaFilesService,
    MediaUsageSubscriber,
  ],
  exports: [MediaFilesService, MediaStorageService],
})
export class MediaModule {}
