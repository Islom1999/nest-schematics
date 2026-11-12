import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthThrottle, DeviceInfo } from '@app/common';
import { Device } from '../../auth/current-admin.decorator';
import { ClientAuthResponseDto } from '../dto/client-auth.dto';
import { IdTokenDto } from '../social/id-token.dto';
import { AppleAuthService } from './apple-auth.service';

@ApiTags('client/auth')
@Controller('client/auth/apple')
export class AppleAuthController {
  constructor(private readonly apple: AppleAuthService) {}

  @AuthThrottle()
  @HttpCode(HttpStatus.OK)
  @Post()
  @ApiOperation({ summary: 'Sign in (or sign up) with an Apple identity token; starts a session' })
  @ApiOkResponse({ type: ClientAuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired token' })
  @ApiServiceUnavailableResponse({ description: 'APPLE_CLIENT_IDS is not set or Apple keys are unreachable' })
  signIn(@Body() dto: IdTokenDto, @Device() device: DeviceInfo): Promise<ClientAuthResponseDto> {
    return this.apple.signIn(dto, device);
  }
}
