import { Controller, Get, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { TusUploadResultDto } from './dto/tus-upload-result.dto';
import { TusUploadsService } from './tus-uploads.service';

/**
 * `/api/files/tus/:uploadId/result`: the media file a resumable upload became.
 * `uploadId` is the last segment of the upload URL (`Location` of the tus
 * create response). With `--engine node` the final PATCH also returns the id in
 * the `Upload-Media-Id` header; with tusd the move happens in the post-finish
 * hook right after the last byte, so poll this route until `status` is not
 * `pending`. Like `GET files/:id`, the random id is the access key.
 */
@ApiTags('files')
@Controller('files/tus')
export class TusUploadsController {
  constructor(private readonly uploads: TusUploadsService) {}

  @Get(':uploadId/result')
  @ApiOperation({ summary: 'Result of a resumable (tus) upload: pending, done (with the media file) or failed' })
  @ApiParam({ name: 'uploadId', description: 'Last segment of the tus upload URL' })
  @ApiOkResponse({ type: TusUploadResultDto })
  @ApiNotFoundResponse({ description: 'Unknown or expired upload' })
  result(@Param('uploadId') uploadId: string): Promise<TusUploadResultDto> {
    return this.uploads.result(uploadId);
  }
}
