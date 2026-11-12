/** Image metadata and thumbnail (registered by `npm run g -- upload --thumbnails`). */
export interface ImageInfo {
  width: number | null;
  height: number | null;
  /** Small webp, or null when none is made. */
  thumbnail: Buffer | null;
}

export interface ImageProcessor {
  /** Throws when the file is not a decodable image. */
  process(filePath: string): Promise<ImageInfo>;
}

/** Injection token of the optional ImageProcessor. */
export const MEDIA_IMAGE_PROCESSOR = 'MEDIA_IMAGE_PROCESSOR';

/** Storage key of an image's thumbnail: `.../<random>.png` → `.../<random>.thumb.webp`. */
export function thumbnailKey(path: string): string {
  return `${path.replace(/\.[a-z0-9]+$/i, '')}.thumb.webp`;
}
