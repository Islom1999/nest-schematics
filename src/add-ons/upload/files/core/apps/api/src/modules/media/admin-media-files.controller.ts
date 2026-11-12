import { Delete, Get, Param, ParseUUIDPipe, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AdminAccess, ApiPaginatedResponse, DeleteResultDto } from '@app/common';
import { MediaFileDto, MediaFilesService } from '@app/common/media';
import { MediaUploaderType } from '@app/database';
import { AdminPrincipal, AdminResource, CurrentAdmin } from '../../auth';
import { DeleteMediaFileQueryDto, MediaFileQueryDto, UploadFilesDto, UploadQueryDto } from './dto/media-file-query.dto';

/**
 * `/api/admin/files`: upload, list and delete media files. Permissions
 * `media_file.read` / `media_file.write`. Uploaded files start unused; a
 * record that references them (crud `file(...)` fields, or
 * MediaFilesService.markUsed) keeps them from the orphan cleanup.
 */
@AdminResource('files', { read: ['media_file.read'], write: ['media_file.write'] })
export class AdminMediaFilesController {
  constructor(private readonly media: MediaFilesService) {}

  @AdminAccess('write')
  @Post('upload')
  @UseInterceptors(FilesInterceptor('files'))
  @ApiOperation({ summary: 'Upload one or more files (multipart field "files"); type checked from content' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadFilesDto })
  @ApiCreatedResponse({ type: MediaFileDto, isArray: true })
  async upload(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Query() query: UploadQueryDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<MediaFileDto[]> {
    const saved = await this.media.upload(files ?? [], {
      usage: query.usage,
      uploadedBy: { type: MediaUploaderType.ADMIN, id: admin.id },
    });
    return saved.map((file) => this.media.toDto(file));
  }

  @AdminAccess('read')
  @Get()
  @ApiOperation({ summary: 'Files, newest first, filtered by kind / usage / used / owner' })
  @ApiPaginatedResponse(MediaFileDto)
  findAll(@Query() query: MediaFileQueryDto) {
    return this.media.page(query);
  }

  @AdminAccess('read')
  @Get(':id')
  @ApiOperation({ summary: 'One file' })
  @ApiOkResponse({ type: MediaFileDto })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<MediaFileDto> {
    return this.media.toDto(await this.media.findOne(id));
  }

  @AdminAccess('write')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a file (409 while it is used, unless force=true; never while a record references it)' })
  @ApiOkResponse({ type: DeleteResultDto })
  delete(@Param('id', ParseUUIDPipe) id: string, @Query() query: DeleteMediaFileQueryDto): Promise<DeleteResultDto> {
    return this.media.deleteById(id, { force: query.force });
  }
}
