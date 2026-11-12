import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthThrottle, DeviceInfo } from '@app/common';
import { Device } from '../../auth/current-admin.decorator';
import { ClientAuthResponseDto } from '../dto/client-auth.dto';
import { IdTokenDto } from '../social/id-token.dto';
import { GoogleAuthService } from './google-auth.service';

@ApiTags('client/auth')
@Controller('client/auth/google')
export class GoogleAuthController {
  constructor(private readonly google: GoogleAuthService) {}

  @AuthThrottle()
  @HttpCode(HttpStatus.OK)
  @Post()
  @ApiOperation({ summary: 'Sign in (or sign up) with a Google ID token; starts a session' })
  @ApiOkResponse({ type: ClientAuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired token' })
  @ApiServiceUnavailableResponse({ description: 'GOOGLE_CLIENT_IDS is not set or Google keys are unreachable' })
  signIn(@Body() dto: IdTokenDto, @Device() device: DeviceInfo): Promise<ClientAuthResponseDto> {
    return this.google.signIn(dto, device);
  }
}
