import { open } from 'fs/promises';
import { MediaKind } from '@app/database';

/** File type detected from the first bytes of the content. */
export interface DetectedFileType {
  mime: string;
  /** Extension used for the stored file (never taken from the client). */
  ext: string;
  kind: MediaKind;
}

/** Bytes read from the start of a file for detection. */
export const SIGNATURE_BYTES = 512;

const OFFICE_ZIP: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
};

/**
 * Every MIME type the upload accepts (the whitelist). Anything else, including
 * plain text, HTML and SVG (scriptable), is refused. Add a type by teaching
 * `detectFileType` its signature.
 */
export const MEDIA_MIME_TYPES: Record<MediaKind, string[]> = {
  [MediaKind.IMAGE]: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/heif'],
  [MediaKind.VIDEO]: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/3gpp', 'video/x-msvideo'],
  [MediaKind.AUDIO]: ['audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/flac'],
  [MediaKind.PDF]: ['application/pdf'],
  [MediaKind.OTHER]: ['application/zip', ...Object.values(OFFICE_ZIP)],
};

function ascii(head: Buffer, start: number, end: number): string {
  return head.length >= end ? head.toString('latin1', start, end) : '';
}

function startsWith(head: Buffer, bytes: number[], offset = 0): boolean {
  return head.length >= offset + bytes.length && bytes.every((b, i) => head[offset + i] === b);
}

function type(mime: string, ext: string, kind: MediaKind): DetectedFileType {
  return { mime, ext, kind };
}

/** ISO base media (`....ftyp<brand>`): mp4, mov, m4a, 3gp, avif, heic. */
function isoMedia(brand: string): DetectedFileType {
  if (brand === 'avif' || brand === 'avis') return type('image/avif', 'avif', MediaKind.IMAGE);
  if (['heic', 'heix', 'heim', 'heis'].includes(brand)) return type('image/heic', 'heic', MediaKind.IMAGE);
  if (brand === 'mif1' || brand === 'msf1') return type('image/heif', 'heif', MediaKind.IMAGE);
  if (brand === 'M4A ' || brand === 'M4B ') return type('audio/mp4', 'm4a', MediaKind.AUDIO);
  if (brand === 'qt  ') return type('video/quicktime', 'mov', MediaKind.VIDEO);
  if (brand.startsWith('3gp') || brand.startsWith('3g2')) return type('video/3gpp', '3gp', MediaKind.VIDEO);
  return type('video/mp4', 'mp4', MediaKind.VIDEO);
}

/**
 * Detects the type from magic bytes. The client's file name is only used to
 * tell zip-based office documents apart; its MIME type is never trusted.
 * Returns null for anything that is not on the whitelist.
 */
export function detectFileType(head: Buffer, originalName = ''): DetectedFileType | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return type('image/png', 'png', MediaKind.IMAGE);
  if (startsWith(head, [0xff, 0xd8, 0xff])) return type('image/jpeg', 'jpg', MediaKind.IMAGE);
  const six = ascii(head, 0, 6);
  if (six === 'GIF87a' || six === 'GIF89a') return type('image/gif', 'gif', MediaKind.IMAGE);
  if (ascii(head, 0, 4) === 'RIFF') {
    const format = ascii(head, 8, 12);
    if (format === 'WEBP') return type('image/webp', 'webp', MediaKind.IMAGE);
    if (format === 'WAVE') return type('audio/wav', 'wav', MediaKind.AUDIO);
    if (format === 'AVI ') return type('video/x-msvideo', 'avi', MediaKind.VIDEO);
    return null;
  }
  if (ascii(head, 4, 8) === 'ftyp') return isoMedia(ascii(head, 8, 12));
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    return head.subarray(0, 64).includes('webm')
      ? type('video/webm', 'webm', MediaKind.VIDEO)
      : type('video/x-matroska', 'mkv', MediaKind.VIDEO);
  }
  if (ascii(head, 0, 4) === 'OggS') return type('audio/ogg', 'ogg', MediaKind.AUDIO);
  if (ascii(head, 0, 4) === 'fLaC') return type('audio/flac', 'flac', MediaKind.AUDIO);
  if (ascii(head, 0, 3) === 'ID3') return type('audio/mpeg', 'mp3', MediaKind.AUDIO);
  if (head.length >= 2 && head[0] === 0xff) {
    // MPEG audio frame sync: 11 bits set; layer bits 00 = AAC (ADTS), else MP3.
    if ((head[1] & 0xf6) === 0xf0) return type('audio/aac', 'aac', MediaKind.AUDIO);
    if ((head[1] & 0xe0) === 0xe0 && ((head[1] >> 1) & 0x03) !== 0) return type('audio/mpeg', 'mp3', MediaKind.AUDIO);
  }
  if (ascii(head, 0, 5) === '%PDF-') return type('application/pdf', 'pdf', MediaKind.PDF);
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    const ext = /\.([a-z0-9]+)$/i.exec(originalName)?.[1]?.toLowerCase() ?? '';
    const office = OFFICE_ZIP[ext];
    return office ? type(office, ext, MediaKind.OTHER) : type('application/zip', 'zip', MediaKind.OTHER);
  }
  return null;
}

/** Reads the first `bytes` of a file. */
export async function readFileHead(path: string, bytes = SIGNATURE_BYTES): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
