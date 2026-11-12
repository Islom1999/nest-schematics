import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateRoleDto {
  @ApiProperty({ example: 'Content manager' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    type: [String],
    example: ['product.read', 'product.write'],
    description: 'Keys from GET admin/permissions, or `*` for every permission',
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  permissions: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: 'Content manager' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ type: [String], example: ['product.read'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  permissions?: string[];
}

export class PermissionGroupDto {
  @ApiProperty({ example: 'product' })
  resource: string;

  @ApiProperty({ type: [String], example: ['read', 'write'] })
  actions: string[];
}
