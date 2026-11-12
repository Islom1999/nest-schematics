import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AdminGuard } from './admin.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Global so every feature module can use `@AdminResource` (AdminGuard)
 * without importing AuthModule.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('ADMIN_JWT_SECRET') ?? '';
        if (secret.length < 16) {
          throw new Error('ADMIN_JWT_SECRET must be set in .env (at least 16 characters)');
        }
        return { secret, signOptions: { expiresIn: config.get('ADMIN_JWT_EXPIRES_IN', '1d') } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AdminGuard],
  exports: [AuthService, AdminGuard],
})
export class AuthModule {}
