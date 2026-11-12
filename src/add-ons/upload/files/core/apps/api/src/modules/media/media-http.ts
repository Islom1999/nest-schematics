import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { pipeline } from 'stream/promises';
import { ByteRange, contentDisposition, etagMatches, parseRange, StorageDriver } from '@app/common/media';

export interface SendFileOptions {
  driver: StorageDriver;
  key: string;
  size: number;
  mime: string;
  name: string;
  etag: string;
  /** `inline` for media and PDF, `attachment` for everything else. */
  inline: boolean;
  /** Cache-Control max-age in seconds. */
  maxAge: number;
  /** Honour `Range` (206 / 416). */
  ranges: boolean;
}

const logger = new Logger('MediaHttp');

/**
 * Sends stored bytes with ETag / Cache-Control (304 on a matching
 * If-None-Match) and, with `ranges`, single byte ranges (206, 416 with
 * `Content-Range: bytes` + `*` + `/size` on a bad range). `no-transform`
 * keeps compression from touching ranges.
 */
export async function sendStoredFile(req: Request, res: Response, file: SendFileOptions): Promise<void> {
  res.setHeader('ETag', file.etag);
  res.setHeader('Cache-Control', `public, max-age=${file.maxAge}, no-transform`);
  if (file.ranges) res.setHeader('Accept-Ranges', 'bytes');

  if (etagMatches(req.headers['if-none-match'], file.etag)) {
    res.status(304).end();
    return;
  }

  let range: ByteRange | null = null;
  if (file.ranges) {
    const ifRange = req.headers['if-range'];
    const parsed = parseRange(!ifRange || ifRange === file.etag ? req.headers.range : undefined, file.size);
    if (parsed === 'invalid') {
      res.status(416).setHeader('Content-Range', `bytes */${file.size}`);
      res.end();
      return;
    }
    range = parsed;
  }

  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Disposition', contentDisposition(file.name, file.inline));
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
  } else {
    res.status(200);
    res.setHeader('Content-Length', String(file.size));
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = await file.driver.getStream(file.key, range ?? undefined);
  try {
    await pipeline(stream, res);
  } catch (error) {
    // Client aborts (seeking in a video) end up here too: nothing to answer.
    if (!res.headersSent) throw error;
    const code = (error as { code?: string }).code;
    if (code !== 'ERR_STREAM_PREMATURE_CLOSE') logger.warn(`Streaming ${file.key} failed: ${(error as Error).message}`);
    res.destroy();
  }
}
