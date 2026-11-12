import { Controller, Delete, Head, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { TusNodeServer } from './tus-node.server';

/**
 * tus 1.0 protocol routes, handed to @tus/server as they are: `POST
 * /api/files/tus` creates an upload (Bearer token, Upload-Length,
 * Upload-Metadata `filename`, `filetype`, `usage`), `HEAD` / `PATCH` /
 * `DELETE /api/files/tus/:uploadId` resume, send and cancel it. CORS
 * preflights are answered by app.enableCors(). Not in the OpenAPI documents
 * (use a tus client such as tus-js-client) and not rate limited (one request
 * per chunk).
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('files/tus')
export class TusNodeController {
  constructor(private readonly tus: TusNodeServer) {}

  @Post()
  create(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.tus.handle(req, res);
  }

  @Head(':uploadId')
  offset(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.tus.handle(req, res);
  }

  @Patch(':uploadId')
  append(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.tus.handle(req, res);
  }

  @Delete(':uploadId')
  terminate(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.tus.handle(req, res);
  }
}
