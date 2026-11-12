import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsString, IsUUID, MaxLength, MinLength, NotEquals } from 'class-validator';
import { WalletTransaction, WalletTransactionType } from '@app/database';

/** A ledger row as its owner sees it. */
export class WalletEntryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: Number, description: 'Tiyin, signed: credit > 0, debit < 0' })
  amount: number;

  @ApiProperty({ enum: WalletTransactionType, enumName: 'WalletTransactionType' })
  type: WalletTransactionType;

  @ApiProperty({ type: Number, description: 'Balance after this change (tiyin)' })
  balanceAfter: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  reference: string | null;

  @ApiProperty()
  createdAt: Date;

  static from(row: WalletTransaction): WalletEntryDto {
    return {
      id: row.id,
      amount: row.amount,
      type: row.type,
      balanceAfter: row.balanceAfter,
      reference: row.reference,
      createdAt: row.createdAt,
    };
  }
}

/** `GET client/wallet`: balance and one page of the ledger (newest first). */
export class WalletOverviewDto {
  @ApiProperty({ type: Number, description: 'Tiyin' })
  balance: number;

  @ApiProperty({ type: Number, description: 'Ledger rows (all pages)' })
  count: number;

  @ApiProperty({ type: WalletEntryDto, isArray: true })
  data: WalletEntryDto[];
}

export class AdjustWalletDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId: string;

  @ApiProperty({ type: Number, example: -50000, description: 'Tiyin, signed (a debit cannot overdraw: 409)' })
  @IsInt()
  @NotEquals(0)
  amount: number;

  @ApiProperty({ example: 'Compensation for ticket #123' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  note: string;
}
