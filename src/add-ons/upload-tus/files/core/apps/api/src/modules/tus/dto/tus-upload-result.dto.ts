import { ApiProperty } from '@nestjs/swagger';
import { apiEnum } from '@app/common';
import { MediaFileDto } from '@app/common/media';

export enum TusUploadStatus {
  /** Bytes are still arriving (or the upload is being stored). */
  PENDING = 'pending',
  /** Stored: `file` is the media file. */
  DONE = 'done',
  /** Refused when it finished (type from content, size limit): see `error`. */
  FAILED = 'failed',
}

/** `GET files/tus/:uploadId/result`: what became of a resumable upload. */
export class TusUploadResultDto {
  @ApiProperty({ ...apiEnum(TusUploadStatus, 'TusUploadStatus') })
  status: TusUploadStatus;

  @ApiProperty({ type: MediaFileDto, nullable: true })
  file: MediaFileDto | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  error: string | null;
}
