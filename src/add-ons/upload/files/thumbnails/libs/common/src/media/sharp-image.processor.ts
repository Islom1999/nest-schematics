import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { ImageInfo, ImageProcessor } from './image-processor';
import { readMediaSettings } from './media.settings';

/**
 * Width/height and a webp thumbnail (UPLOAD_THUMBNAIL_WIDTH box, never
 * enlarged, EXIF orientation applied) for every uploaded image
 * (`npm run g -- upload --thumbnails`). sharp's pixel limit guards against
 * decompression bombs.
 */
@Injectable()
export class SharpImageProcessor implements ImageProcessor {
  private readonly width: number;

  constructor(config: ConfigService) {
    this.width = readMediaSettings(config).thumbnailWidth;
  }

  async process(filePath: string): Promise<ImageInfo> {
    const meta = await sharp(filePath).metadata();
    // Orientations 5-8 are rotated by 90°: swap the stored dimensions.
    const rotated = (meta.orientation ?? 1) >= 5;
    const width = (rotated ? meta.height : meta.width) ?? null;
    const height = (rotated ? meta.width : meta.height) ?? null;
    const thumbnail = await sharp(filePath, { animated: false })
      .rotate()
      .resize({ width: this.width, height: this.width, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    return { width, height, thumbnail };
  }
}
