import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, UserOtp, UserSession } from '@app/database';
import { UserOptionsController, UsersController } from './admin/users.controller';
import { UsersService } from './admin/users.service';
import { CLIENT_AUTH_OPTIONS, clientAuthOptions } from './client-auth.config';
import { ClientAuthController } from './client-auth.controller';
import { ClientAuthService } from './client-auth.service';
import { OtpService } from './otp.service';
import { OptionalUserGuard, UserGuard } from './user.guard';
import { UserSessionsService } from './user-sessions.service';

/**
 * Client (app user) auth: sessions with refresh rotation, UserGuard, sign-in
 * methods (registered here by `npm run g -- auth-client --methods ...`) and
 * the admin's `admin/users`. Global, so any module can use UserGuard,
 * `@CurrentUser()` and UserSessionsService without importing it.
 */
@Global()
@Module({
  imports: [JwtModule.register({}), TypeOrmModule.forFeature([User, UserSession, UserOtp])],
  controllers: [ClientAuthController, UsersController, UserOptionsController],
  providers: [
    { provide: CLIENT_AUTH_OPTIONS, inject: [ConfigService], useFactory: clientAuthOptions },
    UserSessionsService,
    ClientAuthService,
    OtpService,
    UserGuard,
    OptionalUserGuard,
    UsersService,
  ],
  exports: [CLIENT_AUTH_OPTIONS, UserSessionsService, ClientAuthService, UserGuard, OptionalUserGuard],
})
export class ClientAuthModule {}
