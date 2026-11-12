import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PaymentInvoice, PaymentStatus, PaymentTransaction } from '@app/database';

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

/** `GET admin/payments/invoices/:id`: the invoice with its provider transactions (oldest first). */
export class PaymentInvoiceDetailDto extends PaymentInvoice {
  @ApiProperty({ type: PaymentTransaction, isArray: true })
  transactions: PaymentTransaction[];
}

/** Period and provider of `GET admin/payments/summary` (and `export`). Rows are counted by `createdAt`. */
export class PaymentPeriodQueryDto {
  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-01-01T00:00:00Z', description: 'createdAt >= from (inclusive)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-02-01T00:00:00Z', description: 'createdAt < to (exclusive)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ type: String, example: 'payme' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_-]{1,20}$/)
  provider?: string;
}

/**
 * `GET admin/payments/export`: the list filters of `POST admin/payments/pagination`
 * as query parameters (`filters` is the same PrimeNG filters object, JSON-encoded),
 * plus the period / provider / status shortcuts.
 */
export class ExportPaymentsQueryDto extends PaymentPeriodQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  @IsOptional()
  @IsIn(Object.values(PaymentStatus))
  status?: PaymentStatus;

  @ApiPropertyOptional({ type: String, example: '{"purpose":{"value":"topup","matchMode":"equals"}}', description: 'TableQuery filters, JSON' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  filters?: string;

  @ApiPropertyOptional({ type: String, description: 'Global search (externalId, account, provider, targetId)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  globalFilter?: string;

  @ApiPropertyOptional({ type: String, example: 'createdAt' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sortField?: string;

  @ApiPropertyOptional({ type: Number, example: -1, description: '1 = ASC, anything else = DESC' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class PaymentTotalsDto {
  @ApiProperty({ type: Number, description: 'Transactions' })
  count: number;

  @ApiProperty({ type: Number, description: 'Sum of their amounts, tiyin' })
  amount: number;
}

export class PaymentStatusTotalsDto extends PaymentTotalsDto {
  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  status: PaymentStatus;
}

export class PaymentProviderTotalsDto extends PaymentTotalsDto {
  @ApiProperty({ type: String, example: 'payme' })
  provider: string;

  @ApiProperty({ type: Number, description: 'Paid transactions' })
  paidCount: number;

  @ApiProperty({ type: Number, description: 'Revenue: paid amount, tiyin' })
  paidAmount: number;
}

/** `GET admin/payments/summary`. Money in tiyin (1 sum = 100 tiyin); cancelled payments are not revenue. */
export class PaymentSummaryDto {
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  from: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  to: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  provider: string | null;

  @ApiProperty({ type: Number, description: 'Paid amount, tiyin' })
  revenue: number;

  @ApiProperty({ type: Number, description: 'Paid transactions' })
  paidCount: number;

  @ApiProperty({ type: Number, description: 'All transactions in the period' })
  count: number;

  @ApiProperty({ type: PaymentStatusTotalsDto, isArray: true, description: 'Every status, zeros included' })
  byStatus: PaymentStatusTotalsDto[];

  @ApiProperty({ type: PaymentProviderTotalsDto, isArray: true, description: 'Providers with transactions in the period' })
  byProvider: PaymentProviderTotalsDto[];
}
