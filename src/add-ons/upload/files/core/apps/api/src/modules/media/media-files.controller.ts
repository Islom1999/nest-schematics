import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { MediaFilesService, thumbnailKey } from '@app/common/media';
import { MediaFile, MediaKind } from '@app/database';
import { sendStoredFile } from './media-http';

const BINARY = { type: 'string', format: 'binary' } as const;
const INLINE_KINDS: string[] = [MediaKind.IMAGE, MediaKind.VIDEO, MediaKind.AUDIO, MediaKind.PDF];

/**
 * `/api/files/:id`: public read by id. Ids are random UUIDs, so a file is
 * only reachable by whoever got its id (like an unlisted link); listing and
 * deleting need a token (`admin/files`, `client/files`). To restrict reads
 * later, add a guard here (e.g. `@UseGuards(AdminGuard)` or a user guard) or
 * check `file.usage` / `file.ownerType` in `load()`.
 * Not rate-limited: pages load many images and players send many ranges.
 */
@ApiTags('files')
@SkipThrottle()
@Controller('files')
export class MediaFilesController {
  constructor(private readonly media: MediaFilesService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Download a file (ETag + Cache-Control; 304 when If-None-Match matches)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({ description: 'File content', schema: BINARY })
  @ApiResponse({ status: 304, description: 'Not modified' })
  @ApiNotFoundResponse({ description: 'Unknown file' })
  async download(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const file = await this.load(id);
    await sendStoredFile(req, res, { ...this.options(file), ranges: false });
  }

  @Get(':id/stream')
  @ApiOperation({ summary: 'Stream a file with HTTP Range support (206 Partial Content, 416 on a bad range)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({ description: 'Whole file', schema: BINARY })
  @ApiResponse({ status: 206, description: 'Requested byte range', schema: BINARY })
  @ApiResponse({ status: 304, description: 'Not modified' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  @ApiNotFoundResponse({ description: 'Unknown file' })
  async stream(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const file = await this.load(id);
    await sendStoredFile(req, res, { ...this.options(file), ranges: true });
  }

  @Get(':id/thumbnail')
  @ApiOperation({ summary: 'Small webp of an image (the image itself when it has no thumbnail)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('image/webp')
  @ApiOkResponse({ description: 'Thumbnail', schema: BINARY })
  @ApiResponse({ status: 304, description: 'Not modified' })
  @ApiNotFoundResponse({ description: 'Unknown file or not an image' })
  async thumbnail(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const file = await this.load(id);
    if (file.kind !== MediaKind.IMAGE) throw new NotFoundException('Not an image');
    const driver = this.media.driverFor(file);
    const key = thumbnailKey(file.path);
    const thumb = await driver.stat(key);
    if (!thumb) {
      await sendStoredFile(req, res, { ...this.options(file), ranges: false });
      return;
    }
    await sendStoredFile(req, res, {
      ...this.options(file),
      key,
      size: thumb.size,
      mime: 'image/webp',
      name: `${file.originalName.replace(/\.[^.]*$/, '')}.webp`,
      etag: `"${file.id}-thumb"`,
      ranges: false,
    });
  }

  private async load(id: string): Promise<MediaFile> {
    const file = await this.media.findOne(id);
    if (!(await this.media.driverFor(file).stat(file.path))) throw new NotFoundException('File not found');
    return file;
  }

  private options(file: MediaFile) {
    return {
      driver: this.media.driverFor(file),
      key: file.path,
      size: file.size,
      mime: file.mime,
      name: file.originalName,
      etag: `"${file.id}-${file.size}"`,
      inline: INLINE_KINDS.includes(file.kind),
      maxAge: this.media.settings.cacheMaxAge,
    };
  }
}
