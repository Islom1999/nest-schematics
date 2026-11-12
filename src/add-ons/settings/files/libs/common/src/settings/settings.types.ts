import { BadRequestException } from '@nestjs/common';

/** Key of the built-in maintenance switch: `{ enabled: boolean, message: string }`. */
export const MAINTENANCE_SETTING = 'maintenance';

export const DEFAULT_MAINTENANCE_MESSAGE = 'The service is under maintenance. Please try again later.';

export interface MaintenanceSetting {
  enabled: boolean;
  message: string;
}

/** Setting keys: letters, digits, `.`, `_`, `-`; start with a letter or digit; up to 100 chars. */
export const SETTING_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function assertSettingKey(key: string): void {
  if (!SETTING_KEY_PATTERN.test(key)) {
    throw new BadRequestException('Invalid setting key (letters, digits, ".", "_", "-"; up to 100 characters)');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lenient read of the stored value: anything unexpected counts as "off". */
export function parseMaintenance(value: unknown): MaintenanceSetting {
  if (!isRecord(value)) return { enabled: false, message: '' };
  return {
    enabled: value.enabled === true,
    message: typeof value.message === 'string' ? value.message : '',
  };
}

/** Shape checks for built-in keys (400 on a bad value); other keys take any JSON. */
export function validateSettingValue(key: string, value: unknown): void {
  if (key !== MAINTENANCE_SETTING) return;
  if (
    !isRecord(value) ||
    typeof value.enabled !== 'boolean' ||
    (value.message !== undefined && typeof value.message !== 'string') ||
    Object.keys(value).some((k) => k !== 'enabled' && k !== 'message')
  ) {
    throw new BadRequestException('maintenance must be { "enabled": boolean, "message"?: string }');
  }
  if (typeof value.message === 'string' && value.message.length > 500) {
    throw new BadRequestException('maintenance.message must be at most 500 characters');
  }
}
