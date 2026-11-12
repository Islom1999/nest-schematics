import type { Request } from 'express';

/** What a session remembers about the device that signed in. */
export interface DeviceInfo {
  deviceId: string | null;
  deviceName: string | null;
  platform: string | null;
  os: string | null;
  appVersion: string | null;
  ip: string;
  userAgent: string;
}

function header(req: Request, name: string, max: number): string | null {
  const raw = req.headers[name];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value ? value.slice(0, max) : null;
}

/** Best-effort OS name from a User-Agent string. */
export function osFromUserAgent(ua: string): string | null {
  if (/windows/i.test(ua)) return 'Windows';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/mac os x|macintosh/i.test(ua)) return 'macOS';
  if (/cros/i.test(ua)) return 'ChromeOS';
  if (/linux/i.test(ua)) return 'Linux';
  return null;
}

/**
 * Device fields from the request: `x-device-id`, `x-device-name`,
 * `x-platform`, `x-os`, `x-app-version` headers (mobile apps send them; the web
 * admin may not), plus User-Agent and client IP. `req.ip` honours the
 * TRUST_PROXY setting, so X-Forwarded-For is only used behind a known proxy.
 */
export function extractDeviceInfo(req: Request): DeviceInfo {
  const userAgent = header(req, 'user-agent', 512) ?? '';
  return {
    deviceId: header(req, 'x-device-id', 200),
    deviceName: header(req, 'x-device-name', 200),
    platform: header(req, 'x-platform', 50)?.toLowerCase() ?? null,
    os: header(req, 'x-os', 100) ?? osFromUserAgent(userAgent),
    appVersion: header(req, 'x-app-version', 50),
    ip: (req.ip ?? req.socket?.remoteAddress ?? '').slice(0, 64),
    userAgent,
  };
}
