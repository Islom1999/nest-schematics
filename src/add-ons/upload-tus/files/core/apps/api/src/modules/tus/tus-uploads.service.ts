import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { stat } from 'fs/promises';
import { MediaFilesService, MediaUploader } from '@app/common/media';
import {
  checkTusCreate,
  isTusUploadId,
  metadataValue,
  readTusResult,
  readTusSettings,
  removeTusUpload,
  TUS_UPLOADER_ID_KEY,
  TUS_UPLOADER_TYPE_KEY,
  TusCreateCheck,
  TusCreateInput,
  TusMetadata,
  TusSettings,
  tusUploadExists,
  tusUploadPath,
  writeTusResult,
} from '@app/common/media/tus';
import { MediaFile, MediaUploaderType } from '@app/database';
import { TusUploadResultDto, TusUploadStatus } from './dto/tus-upload-result.dto';

export interface TusFinishedUpload {
  id: string;
  metadata?: TusMetadata | null;
}

/**
 * Engine-independent part of resumable uploads: limits on create, and on
 * finish the hand-over to MediaFilesService (type from magic bytes, kind
 * limit, move into the media storage, media_files row with used=false). The
 * outcome is kept in TUS_DIR/.results for `GET files/tus/:uploadId/result`.
 */
@Injectable()
export class TusUploadsService {
  private readonly logger = new Logger(TusUploadsService.name);
  readonly settings: TusSettings;

  constructor(
    private readonly media: MediaFilesService,
    config: ConfigService,
  ) {
    this.settings = readTusSettings(config);
  }

  /** Upload-Length / kind / usage checks of a new upload (400, 413, 415). */
  checkCreate(input: TusCreateInput): TusCreateCheck {
    return checkTusCreate(this.media.settings, input);
  }

  /** Metadata to store with a new upload: the client's keys plus the verified uploader. */
  withUploader(metadata: TusMetadata | null | undefined, uploader: MediaUploader): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata ?? {})) {
      if (typeof value === 'string') result[key] = value;
    }
    result[TUS_UPLOADER_TYPE_KEY] = uploader.type;
    result[TUS_UPLOADER_ID_KEY] = uploader.id;
    return result;
  }

  /**
   * A finished upload becomes a media file. Safe to call twice (tusd retries
   * hooks): a recorded result is returned again. Errors (415 wrong type, 413
   * over the kind limit, ...) are recorded and rethrown; the bytes are removed
   * either way.
   */
  async complete(upload: TusFinishedUpload): Promise<MediaFile> {
    const { id } = upload;
    if (!isTusUploadId(id)) throw new NotFoundException('Unknown upload');
    const dir = this.settings.dir;
    const previous = await readTusResult(dir, id);
    if (previous?.status === 'done' && previous.mediaId) return this.media.findOne(previous.mediaId);
    if (previous?.status === 'failed') {
      throw new HttpException(previous.message ?? 'Upload failed', previous.statusCode ?? 500);
    }

    try {
      const path = tusUploadPath(dir, id);
      const size = await stat(path).then(
        (info) => info.size,
        () => {
          throw new NotFoundException('Upload data not found');
        },
      );
      const [file] = await this.media.upload(
        [{ path, originalname: metadataValue(upload.metadata, 'filename') || 'file', size }],
        { usage: metadataValue(upload.metadata, 'usage') || undefined, uploadedBy: this.uploaderOf(upload.metadata) },
      );
      await writeTusResult(dir, id, { status: 'done', mediaId: file.id });
      return file;
    } catch (error) {
      const statusCode = error instanceof HttpException ? error.getStatus() : 500;
      const message = error instanceof HttpException ? error.message : 'Could not store the upload';
      if (statusCode >= 500) this.logger.error(`Finishing tus upload ${id} failed: ${(error as Error).message}`);
      await writeTusResult(dir, id, { status: 'failed', statusCode, message });
      throw error;
    } finally {
      await removeTusUpload(dir, id);
    }
  }

  /** State of an upload for the client: pending (still in TUS_DIR), done (+ file) or failed. */
  async result(id: string): Promise<TusUploadResultDto> {
    if (!isTusUploadId(id)) throw new NotFoundException('Unknown upload');
    const record = await readTusResult(this.settings.dir, id);
    if (record?.status === 'done' && record.mediaId) {
      const file = await this.media.findOne(record.mediaId);
      return { status: TusUploadStatus.DONE, file: this.media.toDto(file), error: null };
    }
    if (record?.status === 'failed') {
      return { status: TusUploadStatus.FAILED, file: null, error: record.message ?? 'Upload failed' };
    }
    if (await tusUploadExists(this.settings.dir, id)) return { status: TusUploadStatus.PENDING, file: null, error: null };
    throw new NotFoundException('Unknown upload');
  }

  private uploaderOf(metadata: TusMetadata | null | undefined): MediaUploader | null {
    const type = metadataValue(metadata, TUS_UPLOADER_TYPE_KEY);
    const id = metadataValue(metadata, TUS_UPLOADER_ID_KEY);
    const types: readonly string[] = Object.values(MediaUploaderType);
    if (!id || !type || !types.includes(type)) return null;
    return { type: type as MediaUploaderType, id };
  }
}
