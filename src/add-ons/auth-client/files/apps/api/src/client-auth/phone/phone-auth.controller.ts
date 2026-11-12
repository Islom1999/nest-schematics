import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthThrottle, DeviceInfo } from '@app/common';
import { Device } from '../../auth/current-admin.decorator';
import { ClientAuthResponseDto } from '../dto/client-auth.dto';
import { PhoneCodeSentDto, SendPhoneCodeDto, VerifyPhoneCodeDto } from './phone-auth.dto';
import { PhoneAuthService } from './phone-auth.service';

/** Phone + SMS code sign-in (creates the account on first sign-in). */
@ApiTags('client/auth')
@Controller('client/auth/phone')
export class PhoneAuthController {
  constructor(private readonly phone: PhoneAuthService) {}

  @AuthThrottle()
  @HttpCode(HttpStatus.OK)
  @Post('send-code')
  @ApiOperation({ summary: 'Send a 6-digit sign-in code by SMS (valid 3 minutes)' })
  @ApiOkResponse({ type: PhoneCodeSentDto })
  @ApiTooManyRequestsResponse({ description: '1 code per minute and 5 per hour per phone; limits per IP' })
  sendCode(@Body() dto: SendPhoneCodeDto, @Device() device: DeviceInfo): Promise<PhoneCodeSentDto> {
    return this.phone.sendCode(dto.phone, device);
  }

  @AuthThrottle()
  @HttpCode(HttpStatus.OK)
  @Post('verify')
  @ApiOperation({ summary: 'Sign in (or sign up) with the SMS code; starts a session' })
  @ApiOkResponse({ type: ClientAuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired code' })
  verify(@Body() dto: VerifyPhoneCodeDto, @Device() device: DeviceInfo): Promise<ClientAuthResponseDto> {
    return this.phone.verify(dto.phone, dto.code, device);
  }
}
