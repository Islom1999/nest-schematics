/**
 * Allowed `usage` values (`?usage=` on upload). Extend the list for your app:
 * each value is also a folder name in the storage, so keep to `a-z`, `0-9`
 * and `-`. Rows keep their usage when you remove a value later.
 */
export const MEDIA_USAGES = ['general', 'avatar', 'gallery', 'document'] as const;

export type MediaUsage = (typeof MEDIA_USAGES)[number];

export const DEFAULT_MEDIA_USAGE: MediaUsage = 'general';

export function isMediaUsage(value: unknown): value is MediaUsage {
  return typeof value === 'string' && (MEDIA_USAGES as readonly string[]).includes(value);
}

/** Global route prefix + public file route (`GET /api/files/:id`). Keep in sync with main.ts. */
export const MEDIA_PUBLIC_PATH = '/api/files';
