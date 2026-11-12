import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { unlink } from 'fs/promises';
import { basename } from 'path';
import { EntityManager, In, LessThan, Repository } from 'typeorm';
import { MediaFile, MediaKind, MediaUploaderType } from '@app/database';
import { detectFileType, DetectedFileType, readFileHead } from './file-signature';
import { ImageInfo, ImageProcessor, MEDIA_IMAGE_PROCESSOR, thumbnailKey } from './image-processor';
import { DEFAULT_MEDIA_USAGE, isMediaUsage, MEDIA_USAGES } from './media.constants';
import { formatBytes, MediaSettings, readMediaSettings } from './media.settings';
import { MediaFileDto } from './media-file.dto';
import { MediaStorageService } from './storage/media-storage.service';
import { StorageDriver } from './storage/storage-driver';

/** A file multer wrote to UPLOAD_TMP_DIR (`Express.Multer.File` fits). */
export interface UploadedTempFile {
  path: string;
  originalname: string;
  size: number;
}

/** The record that uses a file, e.g. `{ type: 'product', id: product.id }`. */
export interface MediaOwner {
  type: string;
  id: string;
}

export interface MediaUploader {
  type: MediaUploaderType;
  id: string;
}

export interface UploadOptions {
  /** One of MEDIA_USAGES; default `general`. */
  usage?: string;
  uploadedBy?: MediaUploader | null;
}

export interface MediaFileFilter {
  first?: number;
  rows?: number;
  kind?: MediaKind;
  usage?: string;
  used?: boolean;
  ownerType?: string;
  ownerId?: string;
  search?: string;
  uploadedBy?: MediaUploader;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unique(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
}

/** Multer decodes names as latin1; restore UTF-8 names and drop paths and control characters. */
export function cleanFileName(name: string): string {
  let value = name;
  if (/[\u0080-ÿ]/.test(value)) {
    const utf8 = Buffer.from(value, 'latin1').toString('utf8');
    if (!utf8.includes('�')) value = utf8;
  }
  // eslint-disable-next-line no-control-regex
  value = basename(value.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return value.slice(0, 255) || 'file';
}

/**
 * Media files: upload (checks type and size, stores, records), lookups, usage
 * tracking and cleanup. Other code calls:
 *
 * - `markUsed(ids, { type: 'product', id })` when a record starts using files;
 * - `release(ids)` when it stops (replaced or deleted): the worker deletes
 *   released files after UPLOAD_ORPHAN_HOURS;
 * - `findByIds(ids)` to load them.
 *
 * Entity relations to MediaFile (crud `file(...)` fields) are tracked
 * automatically by MediaUsageSubscriber.
 */
@Injectable()
export class MediaFilesService {
  private readonly logger = new Logger(MediaFilesService.name);
  readonly settings: MediaSettings;

  constructor(
    @InjectRepository(MediaFile) private readonly files: Repository<MediaFile>,
    private readonly storage: MediaStorageService,
    config: ConfigService,
    @Optional() @Inject(MEDIA_IMAGE_PROCESSOR) private readonly images?: ImageProcessor | null,
  ) {
    this.settings = readMediaSettings(config);
  }

  // ── Upload ─────────────────────────────────────────────────────────────

  /**
   * Checks every file first (type from magic bytes, kind allowed, per-kind
   * size), then stores them under random names and creates the rows. The
   * temp files are always removed. All or nothing for the checks.
   */
  async upload(files: UploadedTempFile[], options: UploadOptions = {}): Promise<MediaFile[]> {
    try {
      if (!files.length) throw new BadRequestException('No files uploaded (multipart field "files")');
      if (files.length > this.settings.maxFiles) {
        throw new BadRequestException(`At most ${this.settings.maxFiles} files per request`);
      }
      const usage = options.usage || DEFAULT_MEDIA_USAGE;
      if (!isMediaUsage(usage)) {
        throw new BadRequestException(`usage must be one of: ${MEDIA_USAGES.join(', ')}`);
      }
      const checked: { file: UploadedTempFile; type: DetectedFileType; name: string }[] = [];
      for (const file of files) {
        const name = cleanFileName(file.originalname);
        const type = detectFileType(await readFileHead(file.path), name);
        if (!type || !this.settings.allowedKinds.includes(type.kind)) {
          throw new UnsupportedMediaTypeException(`${name}: this file type is not allowed`);
        }
        const limit = this.settings.maxBytes[type.kind];
        if (file.size > limit) {
          throw new PayloadTooLargeException(`${name}: ${type.kind} files are limited to ${formatBytes(limit)}`);
        }
        checked.push({ file, type, name });
      }
      const saved: MediaFile[] = [];
      for (const item of checked) saved.push(await this.store(item.file, item.type, item.name, usage, options.uploadedBy));
      return saved;
    } finally {
      await Promise.all(files.map((f) => unlink(f.path).catch(() => undefined)));
    }
  }

  private async store(
    file: UploadedTempFile,
    type: DetectedFileType,
    originalName: string,
    usage: string,
    uploadedBy?: MediaUploader | null,
  ): Promise<MediaFile> {
    const now = new Date();
    const date = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      String(now.getUTCDate()).padStart(2, '0'),
    ].join('/');
    const key = `${type.kind}/${usage}/${date}/${randomBytes(16).toString('hex')}.${type.ext}`;
    const driver = this.storage.defaultDriver;

    let image: ImageInfo | null = null;
    if (type.kind === MediaKind.IMAGE && this.images) {
      try {
        image = await this.images.process(file.path);
      } catch {
        throw new UnsupportedMediaTypeException(`${originalName}: not a valid image`);
      }
    }

    await driver.put(key, { path: file.path, move: true }, type.mime);
    try {
      if (image?.thumbnail) await driver.put(thumbnailKey(key), image.thumbnail, 'image/webp');
      return await this.files.save(
        this.files.create({
          kind: type.kind,
          usage,
          storage: driver.name,
          path: key,
          originalName,
          mime: type.mime,
          size: file.size,
          width: image?.width ?? null,
          height: image?.height ?? null,
          duration: null,
          used: false,
          ownerType: null,
          ownerId: null,
          uploadedById: uploadedBy?.id ?? null,
          uploadedByType: uploadedBy?.type ?? null,
        }),
      );
    } catch (error) {
      await this.deleteObjects(driver, key, type.kind);
      throw error;
    }
  }

  // ── Lookups ────────────────────────────────────────────────────────────

  /** Rows for `ids` (unknown and malformed ids are skipped). */
  async findByIds(ids: string[]): Promise<MediaFile[]> {
    const valid = unique(ids).filter((id) => UUID.test(id));
    return valid.length ? this.files.find({ where: { id: In(valid) } }) : [];
  }

  async findOne(id: string): Promise<MediaFile> {
    const file = UUID.test(id) ? await this.files.findOne({ where: { id } }) : null;
    if (!file) throw new NotFoundException('File not found');
    return file;
  }

  /** Newest first, filtered; for the admin table. */
  async page(filter: MediaFileFilter): Promise<{ count: number; data: MediaFileDto[] }> {
    const qb = this.files.createQueryBuilder('file');
    if (filter.kind) qb.andWhere('file.kind = :kind', { kind: filter.kind });
    if (filter.usage) qb.andWhere('file.usage = :usage', { usage: filter.usage });
    if (filter.used !== undefined) qb.andWhere('file.used = :used', { used: filter.used });
    if (filter.ownerType) qb.andWhere('file.ownerType = :ownerType', { ownerType: filter.ownerType });
    if (filter.ownerId) qb.andWhere('file.ownerId = :ownerId', { ownerId: filter.ownerId });
    if (filter.uploadedBy) {
      qb.andWhere('file.uploadedByType = :byType AND file.uploadedById = :byId', {
        byType: filter.uploadedBy.type,
        byId: filter.uploadedBy.id,
      });
    }
    const search = filter.search?.trim();
    if (search) {
      qb.andWhere(`file.originalName ILIKE :search ESCAPE '\\'`, { search: `%${search.replace(/[\\%_]/g, '\\$&')}%` });
    }
    const [rows, count] = await qb
      .orderBy('file.createdAt', 'DESC')
      .addOrderBy('file.id', 'DESC')
      .skip(filter.first ?? 0)
      .take(Math.min(Math.max(filter.rows ?? 20, 1), 100))
      .getManyAndCount();
    return { count, data: rows.map((row) => this.toDto(row)) };
  }

  /** Response shape with download URLs (S3_PUBLIC_URL when set, else the API route). */
  toDto(file: MediaFile): MediaFileDto {
    const direct = this.driverFor(file).url?.(file.path) ?? null;
    const base = `${this.settings.publicUrl}/${file.id}`;
    return {
      id: file.id,
      kind: file.kind,
      usage: file.usage,
      storage: file.storage,
      originalName: file.originalName,
      mime: file.mime,
      size: file.size,
      width: file.width,
      height: file.height,
      duration: file.duration,
      used: file.used,
      ownerType: file.ownerType,
      ownerId: file.ownerId,
      uploadedById: file.uploadedById,
      uploadedByType: file.uploadedByType,
      url: direct ?? base,
      thumbnailUrl: file.kind === MediaKind.IMAGE ? `${base}/thumbnail` : null,
      createdAt: file.createdAt,
    };
  }

  driverFor(file: Pick<MediaFile, 'storage'>): StorageDriver {
    return this.storage.driver(file.storage);
  }

  // ── Usage ──────────────────────────────────────────────────────────────

  /**
   * Marks files as used by `owner` (400 for unknown ids). Pass the
   * transaction's `manager` to run inside it. A file used by several records
   * keeps the last owner; the cleanup never deletes a file that a foreign key
   * still references.
   */
  async markUsed(ids: string[], owner: MediaOwner, manager?: EntityManager): Promise<void> {
    const list = unique(ids);
    if (!list.length) return;
    const repo = manager ? manager.getRepository(MediaFile) : this.files;
    const valid = list.filter((id) => UUID.test(id));
    const found = valid.length ? await repo.find({ select: { id: true }, where: { id: In(valid) } }) : [];
    if (found.length !== list.length) {
      const known = new Set(found.map((f) => f.id));
      throw new BadRequestException(`Unknown file id(s): ${list.filter((id) => !known.has(id)).join(', ')}`);
    }
    await repo.update({ id: In(list) }, { used: true, ownerType: owner.type, ownerId: String(owner.id) });
  }

  /** Marks files as unused (replaced or removed); the worker deletes them later. Unknown ids are ignored. */
  async release(ids: string[], manager?: EntityManager): Promise<void> {
    const list = unique(ids).filter((id) => UUID.test(id));
    if (!list.length) return;
    const repo = manager ? manager.getRepository(MediaFile) : this.files;
    await repo.update({ id: In(list) }, { used: false, ownerType: null, ownerId: null });
  }

  // ── Delete ─────────────────────────────────────────────────────────────

  /**
   * Deletes a file (row, then bytes). A used file is refused (409) unless
   * `force`; with `uploadedBy` only that uploader's files can be deleted.
   */
  async deleteById(
    id: string,
    options: { force?: boolean; uploadedBy?: MediaUploader } = {},
  ): Promise<{ deleted: boolean; id: string }> {
    const file = await this.findOne(id);
    const by = options.uploadedBy;
    if (by && (file.uploadedByType !== by.type || file.uploadedById !== by.id)) {
      throw new ForbiddenException('You can delete only your own files');
    }
    if (file.used && !options.force) {
      throw new ConflictException('The file is in use; release it first (admins: ?force=true)');
    }
    if ((await this.referencedIds([file.id])).has(file.id)) {
      throw new ConflictException('The file is still referenced by a record');
    }
    await this.remove(file);
    return { deleted: true, id };
  }

  /** Hard delete: the row first (foreign keys may refuse), then the bytes and thumbnail. */
  async remove(file: MediaFile): Promise<void> {
    await this.files.delete(file.id);
    await this.deleteObjects(this.driverFor(file), file.path, file.kind);
  }

  private async deleteObjects(driver: StorageDriver, key: string, kind: MediaKind): Promise<void> {
    try {
      await driver.delete(key);
      if (kind === MediaKind.IMAGE) await driver.delete(thumbnailKey(key));
    } catch (error) {
      this.logger.warn(`Could not delete ${driver.name}:${key}: ${(error as Error).message}`);
    }
  }

  /**
   * Deletes files that are unused and older than `hours` (UPLOAD_ORPHAN_HOURS),
   * in batches. Files that a foreign key still references are marked used
   * instead. Returns the number deleted.
   */
  async purgeOrphans(hours = this.settings.orphanHours, batchSize = 100): Promise<number> {
    if (hours <= 0) return 0;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    let deleted = 0;
    for (let round = 0; round < 100; round++) {
      const batch = await this.files.find({
        where: { used: false, createdAt: LessThan(cutoff) },
        order: { createdAt: 'ASC' },
        take: batchSize,
      });
      if (!batch.length) break;
      const referenced = await this.referencedIds(batch.map((f) => f.id));
      if (referenced.size) await this.files.update({ id: In([...referenced]) }, { used: true });
      let progress = referenced.size;
      for (const file of batch) {
        if (referenced.has(file.id)) continue;
        try {
          await this.remove(file);
          deleted++;
          progress++;
        } catch (error) {
          this.logger.warn(`Could not delete media file ${file.id}: ${(error as Error).message}`);
        }
      }
      if (batch.length < batchSize || progress === 0) break;
    }
    return deleted;
  }

  /** Ids among `ids` that any foreign key column (crud `file(...)` fields, join tables) points at. */
  async referencedIds(ids: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    if (!ids.length) return found;
    const keys: { tableName: string; columnName: string }[] = await this.files.query(
      `SELECT c.conrelid::regclass::text AS "tableName", a.attname AS "columnName"
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid = to_regclass($1) AND array_length(c.conkey, 1) = 1`,
      [this.files.metadata.tablePath],
    );
    for (const key of keys) {
      const column = `"${key.columnName.replace(/"/g, '""')}"`;
      const rows: { id: string }[] = await this.files.query(
        `SELECT DISTINCT ${column}::text AS "id" FROM ${key.tableName} WHERE ${column}::text = ANY($1::text[])`,
        [ids],
      );
      rows.forEach((row) => found.add(row.id));
    }
    return found;
  }
}
