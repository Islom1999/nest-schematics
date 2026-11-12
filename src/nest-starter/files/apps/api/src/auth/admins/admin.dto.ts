import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PASSWORD_MAX, PASSWORD_MIN } from '../dto/sign-in.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class CreateAdminDto {
  @ApiProperty({ example: 'manager@example.com' })
  @Transform(lower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Content manager' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'No role = no permissions' })
  @IsOptional()
  @IsUUID()
  roleId?: string | null;
}

export class UpdateAdminDto {
  @ApiPropertyOptional({ example: 'manager@example.com' })
  @IsOptional()
  @Transform(lower)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ example: 'Content manager' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  roleId?: string | null;
}

export class SetAdminBlockedDto {
  @ApiProperty({ description: 'true blocks the admin and ends all their sessions' })
  @IsBoolean()
  isBlocked: boolean;
}

export class SetAdminRoleDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  roleId: string | null;
}

export class ResetAdminPasswordDto {
  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password: string;
}
