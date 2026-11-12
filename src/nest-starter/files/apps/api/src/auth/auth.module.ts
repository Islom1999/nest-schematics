import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Admin, AdminPasswordReset, AdminRole, AdminSession } from '@app/database';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { AdminGuard } from './admin.guard';
import { AdminSessionsService } from './admin-sessions.service';
import { AdminsController } from './admins/admins.controller';
import { AdminsService } from './admins/admins.service';
import { ADMIN_AUTH_OPTIONS, adminAuthOptions } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { PermissionsController } from './roles/permissions.controller';
import { RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';

/**
 * Admin auth: sign-in, sessions (devices) with refresh rotation, AdminGuard,
 * and admin/role management. Global so every feature module can use
 * `@AdminResource` (AdminGuard) without importing it.
 *
 * Secrets are passed per token kind (access/refresh), so JwtModule has no
 * default secret: a token can never be signed with the wrong one.
 */
@Global()
@Module({
  imports: [JwtModule.register({}), TypeOrmModule.forFeature([Admin, AdminRole, AdminSession, AdminPasswordReset])],
  controllers: [AuthController, AdminsController, RolesController, PermissionsController],
  providers: [
    { provide: ADMIN_AUTH_OPTIONS, inject: [ConfigService], useFactory: adminAuthOptions },
    AdminSessionsService,
    AuthService,
    PasswordResetService,
    AdminGuard,
    AdminsService,
    RolesService,
    AdminBootstrapService,
  ],
  exports: [AuthService, AdminGuard, AdminSessionsService],
})
export class AuthModule {}
