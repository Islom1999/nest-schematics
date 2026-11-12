import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const USER_LIST_MAX = 1000;

/** Query of `GET admin/users`: an unpaged list for selects and small tables. */
export class UserListQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive search in name, phone, email and account number', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ type: Number, default: 100, minimum: 1, maximum: USER_LIST_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(USER_LIST_MAX)
  limit?: number;
}
