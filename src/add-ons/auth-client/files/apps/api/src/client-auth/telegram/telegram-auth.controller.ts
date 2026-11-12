import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthThrottle, DeviceInfo } from '@app/common';
import { Device } from '../../auth/current-admin.decorator';
import { ClientAuthResponseDto } from '../dto/client-auth.dto';
import { TelegramWebAppDto, TelegramWidgetDto } from './telegram-auth.dto';
import { TelegramAuthService } from './telegram-auth.service';

@ApiTags('client/auth')
@Controller('client/auth/telegram')
export class TelegramAuthController {
  constructor(private readonly telegram: TelegramAuthService) {}

  @AuthThrottle()
  @HttpCode(HttpStatus.OK)
  @Post()
  @ApiOperation({ summary: 'Sign in (or sign up) with the Telegram Login Widget data; starts a session' })
  @ApiOkResponse({ type: ClientAuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Bad signature or older than TELEGRAM_AUTH_MAX_AGE' })
  @ApiServiceUnavailableResponse({ description: 'BOT_TOKEN is not set' })
  signIn(@Body() dto: TelegramWidgetDto, @Device() device: DeviceInfo): Promise<ClientAuthResponseDto> {
    return this.telegram.signInWithWidget(dto, device);
  }

  @AuthThrottle()
  @HttpCode(HttpStatus.OK)
  @Post('web-app')
  @ApiOperation({ summary: 'Sign in (or sign up) from a Telegram Mini App with initData; starts a session' })
  @ApiOkResponse({ type: ClientAuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Bad signature or older than TELEGRAM_AUTH_MAX_AGE' })
  @ApiServiceUnavailableResponse({ description: 'BOT_TOKEN is not set' })
  signInWebApp(@Body() dto: TelegramWebAppDto, @Device() device: DeviceInfo): Promise<ClientAuthResponseDto> {
    return this.telegram.signInWithWebApp(dto, device);
  }
}
