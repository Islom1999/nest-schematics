import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CancelPaymentDto {
  @ApiProperty({ example: 'Duplicate payment, refunded in the Click cabinet' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  comment: string;

  @ApiPropertyOptional({ description: 'Required for a paid payment: the money was already returned in the provider cabinet' })
  @IsOptional()
  @IsBoolean()
  refundedExternally?: boolean;
}
