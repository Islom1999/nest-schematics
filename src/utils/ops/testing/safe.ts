import { Rule, url } from '@angular-devkit/schematics';
import { mergeSafe } from '../write-safe';

export function safe(options: { force?: boolean; createOnly?: string[] }): Rule {
  return mergeSafe(url('./files'), options.force, options.createOnly);
}
