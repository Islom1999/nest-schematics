import { ForbiddenException, HttpException, Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { isIP } from 'net';
import { TusAuthService } from './tus-auth.service';
import { TusUploadsService } from './tus-uploads.service';

/**
 * tusd v2 HTTP hook request (`-hooks-http`), see
 * https://tus.github.io/tusd/advanced-topics/hooks/ . Only the fields used here.
 */
export interface TusHookRequest {
  Type: string;
  Event: {
    Upload: {
      /** Empty in pre-create. */
      ID?: string;
      Size?: number | null;
      SizeIsDeferred?: boolean;
      Offset?: number;
      MetaData?: Record<string, string> | null;
      IsPartial?: boolean;
      IsFinal?: boolean;
      Storage?: Record<string, string> | null;
    };
    HTTPRequest: {
      Method?: string;
      URI?: string;
      RemoteAddr?: string;
      /** The client's request headers (canonical names, several values each). */
      Header?: Record<string, string[]> | null;
    };
  };
}

/** tusd v2 hook response; every field is optional. */
export interface TusHookResponse {
  HTTPResponse?: { StatusCode?: number; Body?: string; Header?: Record<string, string> };
  RejectUpload?: boolean;
  ChangeFileInfo?: { ID?: string; MetaData?: Record<string, string> };
  StopUpload?: boolean;
  RejectTermination?: boolean;
}

/** Same length → constant-time comparison of two secrets. */
export function secretsMatch(given: string | undefined, expected: string): boolean {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b) && !!given;
}

/** Loopback, RFC 1918, link-local and unique-local addresses (Docker / k8s networks). */
export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIP(ip) === 6) return ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  return false;
}

function header(headers: Record<string, string[]> | null | undefined, name: string): string | undefined {
  const key = Object.keys(headers ?? {}).find((k) => k.toLowerCase() === name);
  return key ? headers?.[key]?.[0] : undefined;
}

function reject(error: HttpException): TusHookResponse {
  const status = error.getStatus();
  return {
    RejectUpload: true,
    HTTPResponse: {
      StatusCode: status,
      Body: JSON.stringify({ statusCode: status, message: error.message }),
      Header: { 'Content-Type': 'application/json' },
    },
  };
}

/**
 * tusd hooks (`--engine tusd`):
 * - pre-create: verifies the client's Authorization (admin or user token) and
 *   the limits, then pins the uploader into the upload's metadata;
 * - post-finish: checks the bytes (magic bytes, kind limit), moves them from
 *   tusd's folder (TUS_DIR) into the media storage and records media_files.
 * Other hook types are acknowledged with `{}`.
 */
@Injectable()
export class TusHooksService {
  private readonly logger = new Logger(TusHooksService.name);

  constructor(
    private readonly uploads: TusUploadsService,
    private readonly auth: TusAuthService,
  ) {}

  /**
   * Hooks come from tusd only: with TUS_HOOK_SECRET the X-Tus-Hook-Secret
   * header must match (tusd forwards it from the request your proxy sends,
   * `-hooks-http-forward-headers`); without it only private network addresses
   * are accepted.
   */
  assertTrusted(secret: string | undefined, remoteAddress: string | undefined): void {
    const expected = this.uploads.settings.hookSecret;
    if (expected) {
      if (!secretsMatch(secret, expected)) throw new ForbiddenException('Invalid hook secret');
      return;
    }
    if (!isPrivateAddress(remoteAddress)) {
      throw new ForbiddenException('tus hooks are accepted from private networks only (or set TUS_HOOK_SECRET)');
    }
  }

  async handle(hook: TusHookRequest): Promise<TusHookResponse> {
    switch (hook?.Type) {
      case 'pre-create':
        return this.preCreate(hook);
      case 'post-finish':
        return this.postFinish(hook);
      default:
        return {};
    }
  }

  private async preCreate(hook: TusHookRequest): Promise<TusHookResponse> {
    const upload = hook.Event?.Upload ?? {};
    try {
      if (upload.IsPartial || upload.IsFinal) {
        throw new HttpException('Concatenated uploads are not supported', 400);
      }
      const uploader = await this.auth.authenticate(header(hook.Event?.HTTPRequest?.Header, 'authorization'));
      this.uploads.checkCreate({ size: upload.Size, deferred: upload.SizeIsDeferred, metadata: upload.MetaData });
      return { ChangeFileInfo: { MetaData: this.uploads.withUploader(upload.MetaData, uploader) } };
    } catch (error) {
      if (error instanceof HttpException) return reject(error);
      throw error;
    }
  }

  private async postFinish(hook: TusHookRequest): Promise<TusHookResponse> {
    const upload = hook.Event?.Upload ?? {};
    try {
      const file = await this.uploads.complete({ id: upload.ID ?? '', metadata: upload.MetaData });
      this.logger.log(`tus upload ${upload.ID} stored as media file ${file.id}`);
    } catch (error) {
      // Recorded for GET files/tus/:uploadId/result; tusd cannot tell the client anymore.
      if (!(error instanceof HttpException)) throw error;
      this.logger.warn(`tus upload ${upload.ID} refused: ${error.message}`);
    }
    return {};
  }
}
