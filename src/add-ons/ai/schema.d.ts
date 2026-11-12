export type AiProviderName = 'openrouter' | 'gemini';

export interface Schema {
  /** Provider to add. Default: the installed one, else `openrouter`. */
  provider?: AiProviderName;
  /** Client AI chat (needs auth-client). */
  chat?: boolean;
  /** Per-user chat limits (needs --chat). */
  quota?: boolean;
  /** Overwrite generated files that you have edited. */
  force?: boolean;
  /** Do not run npm install. */
  skipInstall?: boolean;
  /** Project directory relative to the current directory. */
  root?: string;
}
