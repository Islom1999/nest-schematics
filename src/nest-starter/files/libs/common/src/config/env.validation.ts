import { plainToInstance, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min, MinLength, validateSync } from 'class-validator';

/**
 * `.env` schema shared by every app — an app refuses to boot with a clear
 * message instead of failing later. App-specific keys are checked where used
 * (e.g. BOT_TOKEN in the bot); the api AuthModule also requires the admin secrets.
 */
class EnvironmentVariables {
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

  // Admin auth (apps/api). Secrets are optional here because bot/worker do not need them.
  @IsOptional()
  @IsString()
  @MinLength(32)
  ADMIN_JWT_SECRET?: string;

  @IsOptional()
  @IsString()
  @MinLength(32)
  ADMIN_REFRESH_SECRET?: string;

  @IsOptional()
  @IsString()
  ADMIN_JWT_EXPIRES_IN?: string;

  @IsOptional()
  @IsString()
  ADMIN_REFRESH_EXPIRES_IN?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ADMIN_SESSION_LIMIT?: number;

  @IsOptional()
  @IsString()
  ADMIN_EMAIL?: string;

  @IsOptional()
  @IsString()
  ADMIN_PASSWORD?: string;
  // @ns:env (add-ons insert their keys above this line)
}

export function validateEnv(config: Record<string, unknown>) {
  const env = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length) {
    const lines = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    throw new Error(`Invalid .env (copy .env.example to .env):\n  - ${lines.join('\n  - ')}`);
  }
  return config;
}
