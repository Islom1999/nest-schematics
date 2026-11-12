import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { apiEnum } from '@app/common';
import { ClientUserDto } from './client-user.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ClientAuthResponseDto {
  @ApiProperty({ description: 'Bearer token for client API calls' })
  accessToken: string;

  @ApiProperty({ description: 'Single use: POST client/auth/refresh returns a new one' })
  refreshToken: string;

  @ApiProperty({ example: 900, description: 'Access token lifetime in seconds' })
  expiresIn: number;

  @ApiProperty({ type: ClientUserDto })
  user: ClientUserDto;

  @ApiProperty({ description: 'The account was created by this sign-in' })
  isNew: boolean;
}

export class UpdateMeDto {
  @ApiPropertyOptional({ example: 'Ali Valiyev' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'uz', description: 'Language code (uz, ru, en, uz-Cyrl...)' })
  @IsOptional()
  @Matches(/^[a-z]{2}(-[A-Za-z]{2,4})?$/)
  language?: string | null;
}

export enum PushPlatform {
  Ios = 'ios',
  Android = 'android',
  Web = 'web',
}

export class PushTokenDto {
  @ApiProperty({ description: 'FCM / APNs registration token of this device' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token: string;

  @ApiPropertyOptional({ ...apiEnum(PushPlatform, 'PushPlatform') })
  @IsOptional()
  @IsEnum(PushPlatform)
  platform?: PushPlatform;
}
