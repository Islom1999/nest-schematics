import { Controller, Delete, Param, ParseUUIDPipe, Post, Query, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeleteResultDto } from '@app/common';
import { MediaFileDto, MediaFilesService } from '@app/common/media';
import { MediaUploaderType } from '@app/database';
import { CurrentUser, UserGuard, UserPrincipal } from '../../client-auth';
import { UploadFilesDto, UploadQueryDto } from './dto/media-file-query.dto';

/**
 * `/api/client/files`: signed-in users upload files (same checks and limits
 * as admins) and delete their own unused ones. Reading is public by id
 * (`GET files/:id`). Added by `npm run g -- upload` once `auth-client` is installed.
 */
@ApiTags('client/files')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('client/files')
export class ClientMediaFilesController {
  constructor(private readonly media: MediaFilesService) {}

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files'))
  @ApiOperation({ summary: 'Upload one or more files (multipart field "files")' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadFilesDto })
  @ApiCreatedResponse({ type: MediaFileDto, isArray: true })
  async upload(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Query() query: UploadQueryDto,
    @CurrentUser() user: UserPrincipal,
  ): Promise<MediaFileDto[]> {
    const saved = await this.media.upload(files ?? [], {
      usage: query.usage,
      uploadedBy: { type: MediaUploaderType.USER, id: user.id },
    });
    return saved.map((file) => this.media.toDto(file));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete one of your own files (409 while it is used)' })
  @ApiOkResponse({ type: DeleteResultDto })
  delete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: UserPrincipal): Promise<DeleteResultDto> {
    return this.media.deleteById(id, { uploadedBy: { type: MediaUploaderType.USER, id: user.id } });
  }
}
