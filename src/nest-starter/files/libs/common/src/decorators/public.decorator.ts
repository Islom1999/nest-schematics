import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Skips AdminGuard on a route (e.g. sign-in). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
