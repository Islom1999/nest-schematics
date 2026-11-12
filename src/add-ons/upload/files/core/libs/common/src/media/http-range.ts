/** Inclusive byte range, as in `Content-Range: bytes start-end/size`. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parses a single-range `Range` header against a file of `size` bytes:
 * - `null`: no header (send the whole file);
 * - `'invalid'`: malformed, multiple ranges or not satisfiable (answer 416 with
 *   `Content-Range: bytes *` + `/size`);
 * - otherwise the clamped range (`bytes=0-`, `bytes=100-199`, `bytes=-500`).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | 'invalid' | null {
  if (header === undefined || header.trim() === '') return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '') || size <= 0) return 'invalid';
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix === 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return 'invalid';
  return { start, end };
}

/** True when an `If-None-Match` header matches `etag` (weak comparison, `*` matches all). */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const bare = (tag: string) => tag.trim().replace(/^W\//, '');
  return header.split(',').some((tag) => tag.trim() === '*' || bare(tag) === bare(etag));
}

/** `Content-Disposition` with an ASCII fallback and the UTF-8 name (RFC 6266). */
export function contentDisposition(name: string, inline: boolean): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\%]/g, '_') || 'file';
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
