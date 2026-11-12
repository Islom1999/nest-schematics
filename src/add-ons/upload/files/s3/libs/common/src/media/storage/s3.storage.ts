import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import { MediaStorage } from '@app/database';
import { ByteRange } from '../http-range';
import { assertSafeKey, StorageDriver, StorageSource, StoredObjectStat } from './storage-driver';

function isTrue(value: string | undefined): boolean {
  return ['true', '1'].includes((value ?? '').trim().toLowerCase());
}

function isMissing(error: unknown): boolean {
  if (error instanceof S3ServiceException) {
    return error.$metadata.httpStatusCode === 404 || error.name === 'NotFound' || error.name === 'NoSuchKey';
  }
  return false;
}

/**
 * S3-compatible storage (AWS S3, MinIO, R2...). Env: S3_ENDPOINT (empty = AWS),
 * S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_FORCE_PATH_STYLE
 * (true for MinIO), S3_PUBLIC_URL (optional: files are then linked directly,
 * e.g. a CDN or a public bucket). The client connects lazily, so creating it
 * is safe in `swagger:export`.
 */
@Injectable()
export class S3StorageDriver implements StorageDriver, OnModuleDestroy {
  readonly name = MediaStorage.S3;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('S3_ENDPOINT')?.trim();
    const accessKeyId = config.get<string>('S3_ACCESS_KEY')?.trim();
    const secretAccessKey = config.get<string>('S3_SECRET_KEY')?.trim();
    this.bucket = config.get<string>('S3_BUCKET')?.trim() ?? '';
    this.publicUrl = (config.get<string>('S3_PUBLIC_URL')?.trim() ?? '').replace(/\/+$/, '');
    this.client = new S3Client({
      region: config.get<string>('S3_REGION')?.trim() || 'us-east-1',
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: isTrue(config.get<string>('S3_FORCE_PATH_STYLE')),
      // Without keys the SDK's default chain applies (IAM role, AWS_* env).
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  private target(key: string): { Bucket: string; Key: string } {
    assertSafeKey(key);
    if (!this.bucket) throw new Error('S3_BUCKET is not set');
    return { Bucket: this.bucket, Key: key };
  }

  async put(key: string, source: StorageSource, contentType: string): Promise<void> {
    const target = this.target(key);
    if (Buffer.isBuffer(source)) {
      await this.client.send(new PutObjectCommand({ ...target, Body: source, ContentType: contentType }));
      return;
    }
    const { size } = await stat(source.path);
    await this.client.send(
      new PutObjectCommand({ ...target, Body: createReadStream(source.path), ContentLength: size, ContentType: contentType }),
    );
  }

  async getStream(key: string, range?: ByteRange): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({ ...this.target(key), ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }),
    );
    if (!(result.Body instanceof Readable)) throw new Error(`S3 object ${key} has no readable body`);
    return result.Body;
  }

  async stat(key: string): Promise<StoredObjectStat | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand(this.target(key)));
      return { size: head.ContentLength ?? 0, modifiedAt: head.LastModified };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand(this.target(key)));
  }

  url(key: string): string | null {
    return this.publicUrl ? `${this.publicUrl}/${key}` : null;
  }
}
