import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Files of the tus folder (TUS_DIR), shared by both engines:
 * - `<id>`: the bytes of an unfinished upload;
 * - `<id>.json` (@tus/file-store) or `<id>.info` / `<id>.lock` (tusd): its info;
 * - `.results/<id>.json`: what became of a finished upload (media id or error),
 *   read by `GET files/tus/:uploadId/result`.
 * Finished uploads are moved into the media storage, so whatever stays here
 * is unfinished or failed; the worker deletes it after TUS_EXPIRE_HOURS.
 */
export const TUS_RESULTS_DIR = '.results';

const INFO_SUFFIXES = ['.json', '.info', '.lock'];
const UPLOAD_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type TusResultStatus = 'done' | 'failed';

export interface TusResultRecord {
  status: TusResultStatus;
  /** media_files id (done). */
  mediaId?: string;
  /** HTTP status and message of the failure (failed). */
  statusCode?: number;
  message?: string;
  finishedAt: string;
}

/** Upload ids are random tokens from the tus server; anything else is refused (no path tricks). */
export function isTusUploadId(id: unknown): id is string {
  return typeof id === 'string' && UPLOAD_ID.test(id) && !id.startsWith('.');
}

function assertId(id: string): void {
  if (!isTusUploadId(id)) throw new Error(`Invalid tus upload id: ${JSON.stringify(id)}`);
}

/** Path of the bytes of upload `id`. */
export function tusUploadPath(dir: string, id: string): string {
  assertId(id);
  return join(dir, id);
}

function resultPath(dir: string, id: string): string {
  assertId(id);
  return join(dir, TUS_RESULTS_DIR, `${id}.json`);
}

function ignoreMissing(error: unknown): void {
  if ((error as { code?: string } | null)?.code !== 'ENOENT') throw error;
}

/** True while the bytes of upload `id` are in the tus folder (still uploading, or finishing). */
export async function tusUploadExists(dir: string, id: string): Promise<boolean> {
  try {
    return (await stat(tusUploadPath(dir, id))).isFile();
  } catch (error) {
    ignoreMissing(error);
    return false;
  }
}

/** Deletes the bytes and info files of upload `id` (missing files are fine). */
export async function removeTusUpload(dir: string, id: string): Promise<void> {
  const path = tusUploadPath(dir, id);
  await Promise.all(['', ...INFO_SUFFIXES].map((suffix) => unlink(path + suffix).catch(ignoreMissing)));
}

export async function writeTusResult(dir: string, id: string, record: Omit<TusResultRecord, 'finishedAt'>): Promise<void> {
  const path = resultPath(dir, id);
  await mkdir(join(dir, TUS_RESULTS_DIR), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ ...record, finishedAt: new Date().toISOString() }));
  await rename(tmp, path);
}

export async function readTusResult(dir: string, id: string): Promise<TusResultRecord | null> {
  try {
    return JSON.parse(await readFile(resultPath(dir, id), 'utf8')) as TusResultRecord;
  } catch (error) {
    ignoreMissing(error);
    return null;
  }
}

/** `<id>`, `<id>.info`, `<id>.json`, `<id>.lock` → `<id>`. */
function uploadIdOf(name: string): string {
  const suffix = INFO_SUFFIXES.find((s) => name.endsWith(s));
  return suffix ? name.slice(0, -suffix.length) : name;
}

/**
 * Deletes unfinished uploads that nobody wrote to for `hours` (TUS_EXPIRE_HOURS),
 * with their info files, and results older than that. Returns the number of
 * uploads deleted. `hours` <= 0 keeps everything.
 */
export async function purgeExpiredTusUploads(dir: string, hours: number, now = Date.now()): Promise<number> {
  if (hours <= 0) return 0;
  const cutoff = now - hours * 60 * 60 * 1000;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    ignoreMissing(error);
    return 0;
  }
  // Newest write per upload: the bytes change on every PATCH, the info file does not.
  const lastWrite = new Map<string, number>();
  for (const name of names) {
    const id = uploadIdOf(name);
    if (!isTusUploadId(id)) continue;
    try {
      const info = await stat(join(dir, name));
      if (!info.isFile()) continue;
      lastWrite.set(id, Math.max(lastWrite.get(id) ?? 0, info.mtimeMs));
    } catch (error) {
      ignoreMissing(error);
    }
  }
  let deleted = 0;
  for (const [id, mtime] of lastWrite) {
    if (mtime >= cutoff) continue;
    await removeTusUpload(dir, id);
    deleted++;
  }

  const resultsDir = join(dir, TUS_RESULTS_DIR);
  let results: string[] = [];
  try {
    results = await readdir(resultsDir);
  } catch (error) {
    ignoreMissing(error);
  }
  for (const name of results) {
    const path = join(resultsDir, name);
    try {
      if ((await stat(path)).mtimeMs < cutoff) await unlink(path);
    } catch (error) {
      ignoreMissing(error);
    }
  }
  return deleted;
}
