import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { MediaModule, readMediaSettings } from '@app/common/media';
import { AdminMediaFilesController } from './admin-media-files.controller';
import { MediaFilesController } from './media-files.controller';

/**
 * HTTP routes of the upload add-on: `admin/files` (upload/list/delete),
 * public `files/:id` (+ `/stream`, `/thumbnail`) and, with client auth,
 * `client/files`. Multer writes incoming files to UPLOAD_TMP_DIR on disk
 * (never into memory), capped at the largest per-kind limit and
 * UPLOAD_MAX_FILES; MediaFilesService then checks each file's real type and
 * kind limit.
 */
@Module({
  imports: [
    MediaModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const settings = readMediaSettings(config);
        return {
          dest: settings.tmpDir,
          limits: {
            fileSize: Math.max(...Object.values(settings.maxBytes)),
            files: settings.maxFiles,
            fields: 10,
            parts: settings.maxFiles + 10,
          },
        };
      },
    }),
  ],
  controllers: [AdminMediaFilesController, MediaFilesController],
})
export class MediaRoutesModule {}
