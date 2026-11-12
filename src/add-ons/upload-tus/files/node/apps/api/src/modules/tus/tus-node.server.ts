import { HttpException, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Server, Upload } from '@tus/server';
import { mkdir } from 'fs/promises';
import type { IncomingMessage, ServerResponse } from 'http';
import { MediaFilesService } from '@app/common/media';
import { maxTusUploadBytes, TUS_MEDIA_ID_HEADER } from '@app/common/media/tus';
import { API_PREFIX } from '../../config/swagger';
import { TusAuthService } from './tus-auth.service';
import { TusUploadsService } from './tus-uploads.service';

/** Route of the tus endpoint (global prefix included). */
export const TUS_NODE_PATH = `/${API_PREFIX}/files/tus`;

/** Error shape @tus/server turns into the HTTP response (`status_code` + `body`). */
export class TusHttpError extends Error {
  constructor(
    readonly status_code: number,
    readonly body: string,
  ) {
    super(body);
  }
}

function toTusError(error: unknown): TusHttpError {
  if (error instanceof TusHttpError) return error;
  if (error instanceof HttpException) {
    return new TusHttpError(error.getStatus(), JSON.stringify({ statusCode: error.getStatus(), message: error.message }));
  }
  return new TusHttpError(500, JSON.stringify({ statusCode: 500, message: 'Internal server error' }));
}

/**
 * The tus 1.0 server (@tus/server + @tus/file-store) inside the api, at
 * `/api/files/tus`. Unfinished uploads live in TUS_DIR (one instance, or a
 * shared volume plus a shared locker for several).
 *
 * - create (POST): Authorization (admin or user token), Upload-Length and
 *   `filetype` / `filename` / `usage` metadata are checked before any byte;
 * - PATCH / HEAD / DELETE: the random upload URL is the key (the token may
 *   expire during a long upload);
 * - last PATCH: the file is checked by its magic bytes, moved into the media
 *   storage and recorded (media_files, used=false); the response carries
 *   `Upload-Media-Id` (also `GET files/tus/:uploadId/result`).
 *
 * @tus/server 2.x is an ES module: it is loaded with a dynamic import in
 * onModuleInit (Node >= 20.19 can require ES modules; Jest and
 * `swagger:export` never load it).
 */
@Injectable()
export class TusNodeServer implements OnModuleInit {
  private readonly logger = new Logger(TusNodeServer.name);
  private server?: Server;

  constructor(
    private readonly uploads: TusUploadsService,
    private readonly auth: TusAuthService,
    private readonly media: MediaFilesService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const { Server } = await import('@tus/server');
    const { FileStore } = await import('@tus/file-store');
    const { dir, expireHours } = this.uploads.settings;
    await mkdir(dir, { recursive: true });
    const origins = (this.config.get<string>('CORS_ORIGINS') ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    this.server = new Server({
      path: TUS_NODE_PATH,
      datastore: new FileStore({ directory: dir, expirationPeriodInMilliseconds: expireHours * 60 * 60 * 1000 }),
      relativeLocation: true,
      maxSize: maxTusUploadBytes(this.media.settings),
      // Same origins as app.enableCors() in main.ts (tus writes its own CORS headers).
      allowedOrigins: origins.length ? origins : ['http://localhost:4200'],
      allowedCredentials: true,
      exposedHeaders: [TUS_MEDIA_ID_HEADER],
      disableTerminationForFinishedUploads: true,
      onUploadCreate: (req, upload) => this.onCreate(req, upload),
      onUploadFinish: (_req, upload) => this.onFinish(upload),
    });
    this.logger.log(`tus endpoint ${TUS_NODE_PATH} (uploads in ${dir})`);
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.server) throw new ServiceUnavailableException('The tus server is not ready');
    await this.server.handle(req, res);
  }

  private async onCreate(req: Request, upload: Upload): Promise<{ metadata: Record<string, string> }> {
    try {
      const uploader = await this.auth.authenticate(req.headers.get('authorization'));
      this.uploads.checkCreate({ size: upload.size, deferred: upload.sizeIsDeferred, metadata: upload.metadata });
      return { metadata: this.uploads.withUploader(upload.metadata, uploader) };
    } catch (error) {
      throw toTusError(error);
    }
  }

  private async onFinish(upload: Upload): Promise<{ headers: Record<string, string> }> {
    try {
      const file = await this.uploads.complete({ id: upload.id, metadata: upload.metadata });
      return { headers: { [TUS_MEDIA_ID_HEADER]: file.id } };
    } catch (error) {
      throw toTusError(error);
    }
  }
}
