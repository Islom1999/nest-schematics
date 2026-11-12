import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * System prompts of the AI chat: one Markdown file per prompt in
 * `apps/api/src/modules/ai/chat/prompts/<name>.md` (`default.md` is used when
 * a chat does not pick one). `nest build` copies them next to the bundle
 * (nest-cli.json assets); AI_PROMPTS_DIR points elsewhere if you need to.
 */
@Injectable()
export class AiPromptsService {
  private readonly cache = new Map<string, string>();

  constructor(private readonly config: ConfigService) {}

  /** Directory with the .md files: AI_PROMPTS_DIR, next to this file (ts), or next to the webpack bundle. */
  dir(): string {
    const candidates = [
      this.config.get<string>('AI_PROMPTS_DIR')?.trim(),
      join(__dirname, 'prompts'),
      join(__dirname, 'modules', 'ai', 'chat', 'prompts'),
      join(process.cwd(), 'apps', 'api', 'src', 'modules', 'ai', 'chat', 'prompts'),
    ].filter((d): d is string => !!d);
    return candidates.find((d) => existsSync(d)) ?? candidates[candidates.length - 1];
  }

  /** Prompt names (file names without .md). */
  list(): string[] {
    const dir = this.dir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.slice(0, -3))
      .filter((n) => NAME.test(n))
      .sort();
  }

  /** Text of `prompts/<name>.md`; 400 for an unknown name. Cached outside development. */
  get(name = 'default'): string {
    if (!NAME.test(name)) throw new BadRequestException(`Invalid prompt name "${name}"`);
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;
    const file = join(this.dir(), `${name}.md`);
    if (!existsSync(file)) throw new BadRequestException(`Unknown prompt "${name}" (available: ${this.list().join(', ') || 'none'})`);
    const text = readFileSync(file, 'utf8').trim();
    if (process.env.NODE_ENV !== 'development') this.cache.set(name, text);
    return text;
  }
}
