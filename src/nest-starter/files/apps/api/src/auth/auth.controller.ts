import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthThrottle, DeviceInfo, Public } from '@app/common';
import { AdminGuard } from './admin.guard';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { AdminPrincipal } from './auth.types';
import { CurrentAdmin, Device } from './current-admin.decorator';
import {
  AuthResponseDto,
  AuthUserDto,
  RevokedCountDto,
  SessionDto,
  SuccessDto,
} from './dto/auth-response.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  RefreshTokenDto,
  ResetPasswordDto,
  SignInDto,
  SignInWithTokenDto,
} from './dto/sign-in.dto';

/**
 * Admin authentication. Sign-in returns `{ accessToken, refreshToken,
 * expiresIn, user }` (Fuse `AuthService` reads `accessToken` and `user`).
 * Every session is one device: optional `x-device-id`, `x-device-name`,
 * `x-platform`, `x-app-version` headers are stored with it.
 */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Public()
  @AuthThrottle()
  @HttpCode(HttpStatus.OK)
  @Post('sign-in')
  @ApiOperation({ summary: 'Sign in with email and password (starts a session)' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiTooManyRequestsResponse({ description: '5 failed attempts per email + IP in 15 minutes' })
  signIn(@Body() dto: SignInDto, @Device() device: DeviceInfo): Promise<AuthResponseDto> {
    return this.auth.signIn(dto.email, dto.password, device);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiOperation({ summary: 'New token pair; the refresh token is single use (reuse revokes the session)' })
  @ApiOkResponse({ type: AuthResponseDto })
  refresh(@Body() dto: RefreshTokenDto, @Device() device: DeviceInfo): Promise<AuthResponseDto> {
    return this.auth.refresh(dto.refreshToken, device);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('sign-in-with-token')
  @ApiOperation({ summary: 'Fuse signInUsingToken: valid access token → new token pair for the same session' })
  @ApiOkResponse({ type: AuthResponseDto })
  signInWithToken(@Body() dto: SignInWithTokenDto, @Device() device: DeviceInfo): Promise<AuthResponseDto> {
    return this.auth.signInWithToken(dto.accessToken, device);
  }

  @HttpCode(HttpStatus.OK)
  @Post('sign-out')
  @ApiOperation({ summary: 'End the current session only' })
  @ApiOkResponse({ type: SuccessDto })
  async signOut(@CurrentAdmin() admin: AdminPrincipal): Promise<SuccessDto> {
    await this.auth.signOut(admin);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('sign-out-all')
  @ApiOperation({ summary: 'End every session of the current admin, this one included' })
  @ApiOkResponse({ type: RevokedCountDto })
  async signOutAll(@CurrentAdmin() admin: AdminPrincipal): Promise<RevokedCountDto> {
    return { revoked: await this.auth.signOutAll(admin) };
  }

  @Get('me')
  @ApiOperation({ summary: 'Current admin' })
  @ApiOkResponse({ type: AuthUserDto })
  me(@CurrentAdmin() admin: AdminPrincipal): AuthUserDto {
    return this.auth.me(admin);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Active sessions (devices) of the current admin' })
  @ApiOkResponse({ type: SessionDto, isArray: true })
  sessions(@CurrentAdmin() admin: AdminPrincipal): Promise<SessionDto[]> {
    return this.auth.listSessions(admin.id, admin.sessionId);
  }

  // Declared before `sessions/:id` so "others" is not parsed as an id.
  @Delete('sessions/others')
  @ApiOperation({ summary: 'End every other session (keep this one)' })
  @ApiOkResponse({ type: RevokedCountDto })
  async revokeOthers(@CurrentAdmin() admin: AdminPrincipal): Promise<RevokedCountDto> {
    return { revoked: await this.auth.revokeOtherSessions(admin) };
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: 'End one of my sessions' })
  @ApiOkResponse({ type: SuccessDto })
  async revokeSession(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SuccessDto> {
    await this.auth.revokeSession(admin.id, id, 'revoked');
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  @ApiOperation({ summary: 'Change my password; every other session is ended' })
  @ApiOkResponse({ type: SuccessDto })
  async changePassword(@CurrentAdmin() admin: AdminPrincipal, @Body() dto: ChangePasswordDto): Promise<SuccessDto> {
    await this.auth.changePassword(admin, dto.currentPassword, dto.newPassword);
    return { success: true };
  }

  @Public()
  @AuthThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Email a password reset link (always 204: it does not say whether the email has an account)',
  })
  @ApiNoContentResponse({ description: 'Accepted' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited per IP; one email per account per minute' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.passwordReset.forgot(dto.email);
  }

  @Public()
  @AuthThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('reset-password')
  @ApiOperation({ summary: 'Set a new password with the token from the reset email (single use); ends every session' })
  @ApiNoContentResponse({ description: 'Password changed' })
  @ApiBadRequestResponse({ description: 'Invalid or expired token, or the password breaks the policy' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.passwordReset.reset(dto.token, dto.password);
  }
}
