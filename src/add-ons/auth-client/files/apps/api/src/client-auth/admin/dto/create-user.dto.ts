import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body of `POST admin/users`. Sign-in methods add their fields at the marker
 * (phone, email, password); `PATCH admin/users/:id` accepts the same fields,
 * all optional. Phone and email are unique among users that are not deleted.
 */
export class CreateUserDto {
  @ApiPropertyOptional({ example: 'Ali Valiyev', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'uz', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string | null;

  @ApiPropertyOptional({ description: 'Blocked users cannot sign in', default: false })
  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;
  // @ns:admin-user-fields
}
