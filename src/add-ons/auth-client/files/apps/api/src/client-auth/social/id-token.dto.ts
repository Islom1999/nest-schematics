import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** An OpenID Connect ID token from the provider's native / web SDK. */
export class IdTokenDto {
  @ApiProperty({ description: 'The ID token (JWT) returned by the provider SDK' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  idToken: string;

  @ApiPropertyOptional({
    description: 'Raw nonce the app passed to the provider; required to match when sent',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  nonce?: string;

  @ApiPropertyOptional({
    example: 'Ali Valiyev',
    description: 'Display name for a new account (Apple sends the name only to the app, once)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  name?: string;
}
