import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { DeviceInfo, Public } from '@app/common';
import { Device } from '../auth/current-admin.decorator';
import { RevokedCountDto, SessionDto, SuccessDto } from '../auth/dto/auth-response.dto';
import { RefreshTokenDto } from '../auth/dto/sign-in.dto';
import { ClientAuthService } from './client-auth.service';
import { UserPrincipal } from './client-auth.types';
import { CurrentUser } from './current-user.decorator';
import { ClientAuthResponseDto, PushTokenDto, UpdateMeDto } from './dto/client-auth.dto';
import { ClientUserDto } from './dto/client-user.dto';
import { UserGuard } from './user.guard';

/**
 * Client (app) session routes. Sign-in itself is per method
 * (`client/auth/phone/*`, `client/auth/email/*`, `client/auth/google`...);
 * every sign-in starts one session = one device. Optional `x-device-id`,
 * `x-device-name`, `x-platform`, `x-os`, `x-app-version` headers are stored
 * with it; a new sign-in with the same `x-device-id` replaces that device's session.
 */
@ApiTags('client/auth')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('client/auth')
export class ClientAuthController {
  constructor(private readonly auth: ClientAuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiOperation({ summary: 'New token pair; the refresh token is single use (reuse revokes the session)' })
  @ApiOkResponse({ type: ClientAuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid, expired, reused or revoked refresh token' })
  refresh(@Body() dto: RefreshTokenDto, @Device() device: DeviceInfo): Promise<ClientAuthResponseDto> {
    return this.auth.refresh(dto.refreshToken, device);
  }

  @HttpCode(HttpStatus.OK)
  @Post('sign-out')
  @ApiOperation({ summary: 'End the current session only' })
  @ApiOkResponse({ type: SuccessDto })
  async signOut(@CurrentUser() user: UserPrincipal): Promise<SuccessDto> {
    await this.auth.signOut(user);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('sign-out-all')
  @ApiOperation({ summary: 'End every session of the current user, this one included' })
  @ApiOkResponse({ type: RevokedCountDto })
  async signOutAll(@CurrentUser() user: UserPrincipal): Promise<RevokedCountDto> {
    return { revoked: await this.auth.signOutAll(user) };
  }

  @Get('me')
  @ApiOperation({ summary: 'Current user' })
  @ApiOkResponse({ type: ClientUserDto })
  me(@CurrentUser() user: UserPrincipal): Promise<ClientUserDto> {
    return this.auth.me(user);
  }

  @Put('me')
  @ApiOperation({ summary: 'Update my name or language' })
  @ApiOkResponse({ type: ClientUserDto })
  updateMe(@CurrentUser() user: UserPrincipal, @Body() dto: UpdateMeDto): Promise<ClientUserDto> {
    return this.auth.updateMe(user, dto);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Active sessions (devices) of the current user' })
  @ApiOkResponse({ type: SessionDto, isArray: true })
  sessions(@CurrentUser() user: UserPrincipal): Promise<SessionDto[]> {
    return this.auth.listSessions(user.id, user.sessionId);
  }

  // Declared before `sessions/:id` so "others" is not parsed as an id.
  @Delete('sessions/others')
  @ApiOperation({ summary: 'End every other session (keep this one)' })
  @ApiOkResponse({ type: RevokedCountDto })
  async revokeOthers(@CurrentUser() user: UserPrincipal): Promise<RevokedCountDto> {
    return { revoked: await this.auth.revokeOtherSessions(user) };
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: 'End one of my sessions' })
  @ApiOkResponse({ type: SuccessDto })
  async revokeSession(@CurrentUser() user: UserPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<SuccessDto> {
    await this.auth.revokeSession(user.id, id, 'revoked');
    return { success: true };
  }

  @Put('push-token')
  @ApiOperation({ summary: 'Set the push token of this device (session); signing out stops its pushes' })
  @ApiOkResponse({ type: SuccessDto })
  async setPushToken(@CurrentUser() user: UserPrincipal, @Body() dto: PushTokenDto): Promise<SuccessDto> {
    await this.auth.setPushToken(user, dto.token, dto.platform ?? null);
    return { success: true };
  }
}
