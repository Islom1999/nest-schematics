import { Type } from '@nestjs/common';
import { AiProvider } from '../ai.types';

/**
 * Installed AI providers, in preference order (the first one is the default
 * when AI_PROVIDER is empty). `npm run g -- ai <provider>` adds one above the
 * marker; a custom provider is a class implementing AiProvider listed here.
 */
export const AI_PROVIDER_CLASSES: Type<AiProvider>[] = [
  // @ns:ai-providers
];
