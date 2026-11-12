import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import {
  PaymentInvoiceStatus,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  PaymentTransaction,
} from '@app/database';

/**
 * `{ provider, amount }` = wallet top-up (`--mode wallet`);
 * `{ provider, targetType, targetId }` = pay a registered PaymentTarget (`--mode order`).
 */
export class CheckoutDto {
  @ApiProperty({ enum: PaymentProvider, enumName: 'PaymentProvider' })
  @IsIn(Object.values(PaymentProvider))
  provider: PaymentProvider;

  @ApiPropertyOptional({ type: Number, example: 1500000, description: 'Top-up amount in tiyin (1 sum = 100 tiyin)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @ApiPropertyOptional({ type: String, example: 'order', description: 'PaymentTarget type registered by the app' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{0,63}$/)
  targetType?: string;

  @ApiPropertyOptional({ type: String, example: '42' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetId?: string;
}

export class CheckoutResponseDto {
  @ApiProperty({ format: 'uuid' })
  invoiceId: string;

  @ApiProperty({ type: String, example: '1000000001', description: 'Account value the provider shows' })
  invoiceNumber: string;

  @ApiProperty({ type: Number, description: 'Tiyin' })
  amount: number;

  @ApiProperty({ enum: PaymentInvoiceStatus, enumName: 'PaymentInvoiceStatus' })
  status: PaymentInvoiceStatus;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ type: String, description: 'Open this URL (browser or webview) to pay' })
  payUrl: string;
}

export class PageQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** A payment as its owner sees it (no provider internals). */
export class ClientPaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, example: 'payme' })
  provider: string;

  @ApiProperty({ type: Number, description: 'Tiyin' })
  amount: number;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  status: PaymentStatus;

  @ApiProperty({ enum: PaymentPurpose, enumName: 'PaymentPurpose' })
  purpose: PaymentPurpose;

  @ApiPropertyOptional({ type: String, nullable: true })
  targetType: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  targetId: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  performedAt: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  cancelledAt: Date | null;

  static from(tx: PaymentTransaction): ClientPaymentDto {
    return {
      id: tx.id,
      provider: tx.provider,
      amount: tx.amount,
      status: tx.status,
      purpose: tx.purpose,
      targetType: tx.targetType,
      targetId: tx.targetId,
      createdAt: tx.createdAt,
      performedAt: tx.performedAt,
      cancelledAt: tx.cancelledAt,
    };
  }
}
