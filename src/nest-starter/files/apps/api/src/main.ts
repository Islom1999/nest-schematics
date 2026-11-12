import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter } from '@app/common';
import { ApiModule } from './api.module';
import { setupSwagger } from './config/swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule);
  const config = app.get(ConfigService);

  // Behind nginx: TRUST_PROXY=1 (hop count). Never `true` — X-Forwarded-For could be spoofed.
  const trustProxy = config.get<string>('TRUST_PROXY')?.trim();
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  // JSON API + Swagger UI inline scripts → CSP off.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  const origins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : ['http://localhost:4200'], credentials: true });

  // Frontend (fuse-schematics) calls `${apiUrl}/admin/<resource>` with apiUrl = http://host:3000/api
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerPath = setupSwagger(app);

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  Logger.log(`API: http://localhost:${port}/api`, 'Bootstrap');
  if (swaggerPath) Logger.log(`Swagger: http://localhost:${port}/${swaggerPath}`, 'Bootstrap');
}

void bootstrap();
