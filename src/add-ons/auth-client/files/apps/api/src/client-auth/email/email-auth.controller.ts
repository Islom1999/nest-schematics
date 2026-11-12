import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthThrottle, DeviceInfo } from '@app/common';
import { Device } from '../../auth/current-admin.decorator';
import { SuccessDto } from '../../auth/dto/auth-response.dto';
import { ClientAuthResponseDto } from '../dto/client-auth.dto';
import { EmailDto, EmailSignInDto, EmailSignUpDto, ResetPasswordDto } from './email-auth.dto';
import { EmailAuthService } from './email-auth.service';

/** Email + password sign-up / sign-in and password reset by emailed code. */
@ApiTags('client/auth')
@Controller('client/auth/email')
export class EmailAuthController {
  constructor(private readonly email: EmailAuthService) {}

  @AuthThrottle()
  @HttpCode(HttpStatus.OK)
  @Post('sign-up')
  @ApiOperation({ summary: 'Create an account with email and password; starts a session' })
  @ApiOkResponse({ type: ClientAuthResponseDto })
  @ApiConflictResponse({ description: 'The email is taken' })
  signUp(@Body() dto: EmailSignUpDto, @Device() device: DeviceInfo): Promise<ClientAuthResponseDto> {
    return this.email.signUp(dto.email, dto.password, dto.name, device);
  }

  @AuthThrottle()
  @HttpCode(HttpStatus.OK)
  @Post('sign-in')
  @ApiOperation({ summary: 'Sign in with email and password; starts a session' })
  @ApiOkResponse({ type: ClientAuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiTooManyRequestsResponse({ description: '5 failed attempts per email + IP in 15 minutes' })
  signIn(@Body() dto: EmailSignInDto, @Device() device: DeviceInfo): Promise<ClientAuthResponseDto> {
    return this.email.signIn(dto.email, dto.password, device);
  }

  @AuthThrottle()
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  @ApiOperation({ summary: 'Email a 6-digit reset code (same answer whether the account exists or not)' })
  @ApiOkResponse({ type: SuccessDto })
  async forgotPassword(@Body() dto: EmailDto, @Device() device: DeviceInfo): Promise<SuccessDto> {
    await this.email.forgotPassword(dto.email, device);
    return { success: true };
  }

  @AuthThrottle()
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  @ApiOperation({ summary: 'Set a new password with the emailed code; ends every session' })
  @ApiOkResponse({ type: SuccessDto })
  async resetPassword(@Body() dto: ResetPasswordDto, @Device() device: DeviceInfo): Promise<SuccessDto> {
    await this.email.resetPassword(dto.email, dto.code, dto.newPassword, device);
    return { success: true };
  }
}
