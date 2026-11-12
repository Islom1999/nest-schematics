import { plainToInstance, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, validateSync } from 'class-validator';

/**
 * `.env` schema shared by every app — an app refuses to boot with a clear
 * message instead of failing later. App-specific keys are checked where used
 * (e.g. ADMIN_JWT_SECRET in the api AuthModule, BOT_TOKEN in the bot).
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
