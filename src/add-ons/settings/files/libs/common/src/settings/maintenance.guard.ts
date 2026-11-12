import { CanActivate, ExecutionContext, Injectable, Logger, ServiceUnavailableException, SetMetadata } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { SettingsService } from './settings.service';
import { DEFAULT_MAINTENANCE_MESSAGE } from './settings.types';

export const SKIP_MAINTENANCE_KEY = 'skipMaintenance';

/** Keeps a client route (or controller) working while maintenance is on. */
export const SkipMaintenance = () => SetMetadata(SKIP_MAINTENANCE_KEY, true);

/**
 * Route prefixes (after `/api`) that keep working during maintenance: the
 * admin panel and its sign-in, health probes, the public settings (so apps
 * can read the message) and server-to-server hooks (`internal/*`, e.g. tusd).
 * Swagger docs are not Nest routes and are never
 * blocked. Add a prefix here or use `@SkipMaintenance()` for more.
 */
export const MAINTENANCE_EXEMPT_PREFIXES = ['admin', 'auth', 'health', 'settings/public', 'internal'];

function routePath(...parts: unknown[]): string {
  return parts
    .map((p) => (Array.isArray(p) ? String(p[0] ?? '') : typeof p === 'string' ? p : ''))
    .join('/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

export function isMaintenanceExempt(path: string, prefixes = MAINTENANCE_EXEMPT_PREFIXES): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Global guard (`npm run g -- settings`): while the `maintenance` setting is
 * `{ enabled: true }`, every client route answers 503 with its message and
 * `code: 'MAINTENANCE'`. The flag is read through SettingsService (cached
 * for a few seconds). If the settings cannot be read, requests are let
 * through (fail open) so a database hiccup does not take the API down twice.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  private readonly logger = new Logger('Maintenance');
  private lastErrorAt = 0;

  constructor(
    private readonly settings: SettingsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_MAINTENANCE_KEY, targets)) return true;

    const path = routePath(
      this.reflector.get<unknown>(PATH_METADATA, context.getClass()),
      this.reflector.get<unknown>(PATH_METADATA, context.getHandler()),
    );
    if (isMaintenanceExempt(path)) return true;

    let maintenance;
    try {
      maintenance = await this.settings.maintenance();
    } catch (error) {
      if (Date.now() - this.lastErrorAt > 30_000) {
        this.lastErrorAt = Date.now();
        this.logger.error(`Could not read the maintenance setting: ${(error as Error).message}`);
      }
      return true;
    }
    if (maintenance.enabled) {
      throw new ServiceUnavailableException({
        message: maintenance.message || DEFAULT_MAINTENANCE_MESSAGE,
        code: 'MAINTENANCE',
      });
    }
    return true;
  }
}
