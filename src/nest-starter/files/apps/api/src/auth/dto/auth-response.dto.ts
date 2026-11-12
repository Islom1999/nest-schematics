import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** `user` of the sign-in response and `GET auth/me` (Fuse `User`). */
export class AuthUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'admin@example.com' })
  email: string;

  @ApiProperty({ example: 'Admin' })
  name: string;

  @ApiProperty({ type: [String], example: ['product.read'], description: '`*` = every permission' })
  permissions: string[];
}

export class AuthResponseDto {
  @ApiProperty({ description: 'Bearer token for API calls' })
  accessToken: string;

  @ApiProperty({ description: 'Single use: POST auth/refresh returns a new one' })
  refreshToken: string;

  @ApiProperty({ example: 900, description: 'Access token lifetime in seconds' })
  expiresIn: number;

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;
}

/** One signed-in device. */
export class SessionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  deviceId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  deviceName: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  platform: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  os: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  appVersion: string | null;

  @ApiProperty()
  ip: string;

  @ApiProperty()
  userAgent: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  lastUsedAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt: Date;

  @ApiProperty({ description: 'The session of the token making this request' })
  isCurrent: boolean;
}

export class SuccessDto {
  @ApiProperty({ example: true })
  success: boolean;
}

export class RevokedCountDto {
  @ApiProperty({ example: 2, description: 'Sessions revoked' })
  revoked: number;
}
