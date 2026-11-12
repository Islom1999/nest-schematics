import { ForbiddenException, Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { MediaUploader } from '@app/common/media';
import { MediaUploaderType } from '@app/database';
import { AuthService, hasPermissions } from '../../auth';

/** Verifies user (client) tokens; registered by `npm run g -- upload-tus` once `auth-client` is installed. */
export const TUS_USER_AUTH = 'TUS_USER_AUTH';

export interface TusUserAuthenticator {
  /** Verifies a `Bearer <user token>` header (signature, expiry, session) and returns the user id. */
  authenticate(authorization: string): Promise<{ id: string }>;
}

/** Permission an admin needs to upload (same as `POST admin/files/upload`). */
export const TUS_ADMIN_PERMISSIONS = ['media_file.write'];

/** `typ` claim of a JWT, read without verifying it (only to pick the verifier). */
export function tokenType(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as unknown;
    const typ = (payload as { typ?: unknown } | null)?.typ;
    return typeof typ === 'string' ? typ : null;
  } catch {
    return null;
  }
}

/**
 * Who may create a resumable upload: an admin with `media_file.write`
 * (access token, `typ: 'admin'`, checked by AuthService like AdminGuard does)
 * or, with `auth-client`, a signed-in user (`typ: 'user'`). Both engines call
 * it on create only; after that the random upload URL is the capability.
 */
@Injectable()
export class TusAuthService {
  constructor(
    private readonly admins: AuthService,
    @Optional() @Inject(TUS_USER_AUTH) private readonly users?: TusUserAuthenticator | null,
  ) {}

  async authenticate(authorization: string | null | undefined): Promise<MediaUploader> {
    const [scheme, token] = authorization?.trim().split(/\s+/) ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('Missing bearer token');

    const typ = tokenType(token);
    if (typ === 'admin') {
      const admin = await this.admins.authenticate(token);
      if (!hasPermissions(admin.permissions, TUS_ADMIN_PERMISSIONS)) {
        throw new ForbiddenException('Not enough permissions');
      }
      return { type: MediaUploaderType.ADMIN, id: admin.id };
    }
    if (typ === 'user' && this.users) {
      const user = await this.users.authenticate(`Bearer ${token}`);
      return { type: MediaUploaderType.USER, id: user.id };
    }
    throw new UnauthorizedException('Invalid token');
  }
}
