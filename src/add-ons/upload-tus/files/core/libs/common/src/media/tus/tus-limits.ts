import { BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { MediaKind } from '@app/database';
import { MEDIA_MIME_TYPES } from '../file-signature';
import { isMediaUsage, MEDIA_USAGES } from '../media.constants';
import { formatBytes, MediaSettings } from '../media.settings';

/** tus `Upload-Metadata` as both engines hand it over (values may be null for keys without a value). */
export type TusMetadata = Record<string, string | null | undefined>;

/** Metadata keys the server sets on create (client values are replaced). */
export const TUS_UPLOADER_TYPE_KEY = 'uploaderType';
export const TUS_UPLOADER_ID_KEY = 'uploaderId';

/** What the client declares when it creates an upload. */
export interface TusCreateInput {
  /** Upload-Length; null/undefined with Upload-Defer-Length. */
  size?: number | null;
  /** Upload-Defer-Length was used. */
  deferred?: boolean;
  metadata?: TusMetadata | null;
}

export interface TusCreateCheck {
  /** Kind expected from `filetype` / `filename` (null = unknown until the bytes arrive). */
  kind: MediaKind | null;
  /** Limit applied to the declared size. */
  maxBytes: number;
}

const EXTENSION_KINDS: Record<string, MediaKind> = {
  png: MediaKind.IMAGE,
  jpg: MediaKind.IMAGE,
  jpeg: MediaKind.IMAGE,
  gif: MediaKind.IMAGE,
  webp: MediaKind.IMAGE,
  avif: MediaKind.IMAGE,
  heic: MediaKind.IMAGE,
  heif: MediaKind.IMAGE,
  mp4: MediaKind.VIDEO,
  mov: MediaKind.VIDEO,
  webm: MediaKind.VIDEO,
  mkv: MediaKind.VIDEO,
  '3gp': MediaKind.VIDEO,
  avi: MediaKind.VIDEO,
  mp3: MediaKind.AUDIO,
  aac: MediaKind.AUDIO,
  m4a: MediaKind.AUDIO,
  ogg: MediaKind.AUDIO,
  wav: MediaKind.AUDIO,
  flac: MediaKind.AUDIO,
  pdf: MediaKind.PDF,
  zip: MediaKind.OTHER,
  docx: MediaKind.OTHER,
  xlsx: MediaKind.OTHER,
  pptx: MediaKind.OTHER,
  odt: MediaKind.OTHER,
  ods: MediaKind.OTHER,
};

/** Value of a metadata key, trimmed; empty for missing keys. */
export function metadataValue(metadata: TusMetadata | null | undefined, key: string): string {
  return (metadata?.[key] ?? '').trim();
}

/** Declared types that are never accepted (scriptable or plain text), refused before any byte is sent. */
const REFUSED_MIME = /^text\/|html|svg|xml|javascript|ecmascript/;

/**
 * Kind the client claims: from `filetype` (whitelist, then the `image/`,
 * `video/`, `audio/` prefix), else from the `filename` extension, else null.
 * Only used to pick the size limit early and to refuse obvious misfits; the
 * real type comes from the magic bytes when the upload finishes.
 */
export function declaredKind(metadata: TusMetadata | null | undefined): MediaKind | null {
  const mime = metadataValue(metadata, 'filetype').toLowerCase().split(';')[0].trim();
  if (mime && REFUSED_MIME.test(mime)) {
    throw new UnsupportedMediaTypeException(`${mime}: this file type is not allowed`);
  }
  const listed = (Object.keys(MEDIA_MIME_TYPES) as MediaKind[]).find((k) => MEDIA_MIME_TYPES[k].includes(mime));
  if (listed) return listed;
  const prefix = /^(image|video|audio)\//.exec(mime)?.[1];
  if (prefix) return prefix as MediaKind;
  const ext = /\.([a-z0-9]+)$/i.exec(metadataValue(metadata, 'filename'))?.[1]?.toLowerCase() ?? '';
  return EXTENSION_KINDS[ext] ?? null;
}

/** The largest limit among the allowed kinds (cap for uploads of unknown kind). */
export function maxTusUploadBytes(settings: MediaSettings): number {
  return Math.max(...settings.allowedKinds.map((kind) => settings.maxBytes[kind]));
}

/**
 * Checks an upload when it is created, before any byte is stored:
 * Upload-Length is required (no deferred length), `usage` must be known, the
 * declared kind must be allowed and the size within its UPLOAD_MAX_<KIND>_MB.
 * Throws 400 / 413 / 415.
 */
export function checkTusCreate(settings: MediaSettings, input: TusCreateInput): TusCreateCheck {
  if (input.deferred || input.size === null || input.size === undefined) {
    throw new BadRequestException('Upload-Length is required (Upload-Defer-Length is not supported)');
  }
  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    throw new BadRequestException('Upload-Length must be a positive integer');
  }
  const usage = metadataValue(input.metadata, 'usage');
  if (usage && !isMediaUsage(usage)) {
    throw new BadRequestException(`usage must be one of: ${MEDIA_USAGES.join(', ')}`);
  }
  const kind = declaredKind(input.metadata);
  if (kind && !settings.allowedKinds.includes(kind)) {
    throw new UnsupportedMediaTypeException(`${kind} files are not allowed`);
  }
  const maxBytes = kind ? settings.maxBytes[kind] : maxTusUploadBytes(settings);
  if (input.size > maxBytes) {
    throw new PayloadTooLargeException(
      `${kind ? `${kind} files are` : 'Files are'} limited to ${formatBytes(maxBytes)}`,
    );
  }
  return { kind, maxBytes };
}
