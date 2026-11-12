import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin } from './current-admin.decorator';
import { AdminGuard } from './admin.guard';
import { AuthService } from './auth.service';
import { AuthAdmin } from './auth.types';
import { SignInDto, SignInWithTokenDto } from './dto/sign-in.dto';

/** Same request/response shape as the Fuse `AuthService` (`{ accessToken, user }`). */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post('sign-in')
  signIn(@Body() dto: SignInDto) {
    return this.auth.signIn(dto.email, dto.password);
  }

  @HttpCode(HttpStatus.OK)
  @Post('sign-in-with-token')
  signInWithToken(@Body() dto: SignInWithTokenDto) {
    return this.auth.refresh(dto.accessToken);
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Get('me')
  me(@CurrentAdmin() admin: AuthAdmin) {
    return admin;
  }
}
