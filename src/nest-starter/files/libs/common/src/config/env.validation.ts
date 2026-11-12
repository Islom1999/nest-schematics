import { plainToInstance, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, validateSync } from 'class-validator';

const BOOLEAN = ['true', 'false', '1', '0', ''];

/**
 * `.env` schema shared by every app — an app refuses to boot with a clear
 * message instead of failing later. App-specific keys are checked where used
 * (e.g. ADMIN_JWT_SECRET in the api AuthModule, BOT_TOKEN in the bot).
 * Generators insert their keys at the marker line.
 */
export class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PORT?: number;

  @IsString()
  DB_HOST: string;

  @Type(() => Number)
  @IsInt()
  DB_PORT: number;

  @IsString()
  DB_USERNAME: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  DB_DATABASE: string;

  @IsOptional()
  @IsIn(BOOLEAN)
  DB_SYNCHRONIZE?: string;

  @IsOptional()
  @IsIn(BOOLEAN)
  DB_MIGRATIONS_RUN?: string;

  @IsOptional()
  @IsIn(BOOLEAN)
  DB_LOGGING?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  THROTTLE_TTL?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  THROTTLE_LIMIT?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  AUTH_THROTTLE_LIMIT?: number;
  // @ns:env
}

export function validateEnv(config: Record<string, unknown>) {
  const env = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  const lines = errors.flatMap((e) => Object.values(e.constraints ?? {}));
  if (env.NODE_ENV === 'production' && ['true', '1'].includes(env.DB_SYNCHRONIZE ?? '')) {
    lines.push('DB_SYNCHRONIZE must be off in production (use migrations)');
  }
  if (lines.length) {
    throw new Error(`Invalid .env (copy .env.example to .env):\n  - ${lines.join('\n  - ')}`);
  }
  return config;
}
