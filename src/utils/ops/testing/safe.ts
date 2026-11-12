import { Rule, url } from '@angular-devkit/schematics';
import { mergeSafe } from '../write-safe';

export function safe(options: { force?: boolean }): Rule {
  return mergeSafe(url('./files'), options.force);
}
