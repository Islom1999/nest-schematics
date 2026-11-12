import { SetMetadata } from '@nestjs/common';

/**
 * Generic base-controller routes say whether they read or write; the concrete
 * controller maps that to its own permission keys with `@AdminResource`.
 * AdminGuard combines the two and refuses a route whose level has no mapping.
 */
export type AdminAccessLevel = 'read' | 'write';

export const ADMIN_ACCESS_KEY = 'adminAccess';

export const AdminAccess = (level: AdminAccessLevel) => SetMetadata(ADMIN_ACCESS_KEY, level);

export const ADMIN_RESOURCE_KEY = 'adminResource';

/** Permission keys for the generic read/write routes of one admin resource. */
export interface AdminResourcePermissions {
  read?: string[];
  write?: string[];
}
