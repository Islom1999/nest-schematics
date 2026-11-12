import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { PaymentTransaction } from './payment-transaction.entity';
import { tiyinTransformer } from './payment.types';
import { Wallet } from './wallet.entity';

/**
 * - `topup`: a paid provider payment (credit);
 * - `purchase`: the user bought something from the balance (debit);
 * - `refund`: a purchase returned to the balance (credit);
 * - `reversal`: undoes one earlier row (`reversalOfId`): the provider
 *   cancelled a paid top-up (debit), or an admin reversed a row (either sign);
 * - `adjust`: an admin correction with a note (either sign).
 */
export enum WalletTransactionType {
  TOPUP = 'topup',
  PURCHASE = 'purchase',
  REFUND = 'refund',
  REVERSAL = 'reversal',
  ADJUST = 'adjust',
}

/**
 * Wallet ledger: one row per balance change, never updated. `amount` is
 * signed (credit > 0, debit < 0); `balanceAfter` is the balance right after
 * this change, so the rows of a wallet replay to its balance.
 * Schema: migration `*-wallets.ts` (keep both in sync).
 */
@Entity('wallet_transactions')
@Index('IDX_wallet_transactions_wallet_id_created_at', ['walletId', 'createdAt'])
@Index('IDX_wallet_transactions_payment_transaction_id', ['paymentTransactionId'])
@Index('UQ_wallet_transactions_reversal_of_id', ['reversalOfId'], { unique: true })
export class WalletTransaction extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  walletId: string;

  @ManyToOne(() => Wallet, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'wallet_id', foreignKeyConstraintName: 'FK_wallet_transactions_wallet_id' })
  wallet?: Wallet;

  @ApiProperty({ type: Number, example: -250000, description: 'Tiyin, signed: credit > 0, debit < 0' })
  @Column({ type: 'bigint', transformer: tiyinTransformer })
  amount: number;

  @ApiProperty({ enum: WalletTransactionType, enumName: 'WalletTransactionType' })
  @Column({ type: 'varchar', length: 16 })
  type: WalletTransactionType;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @Column({ type: 'uuid', nullable: true })
  paymentTransactionId: string | null;

  @ManyToOne(() => PaymentTransaction, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payment_transaction_id', foreignKeyConstraintName: 'FK_wallet_transactions_payment_transaction_id' })
  paymentTransaction?: PaymentTransaction;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'order:42', description: 'What the change is for (app defined)' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  reference: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Reason of an admin adjustment' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  /** Unique: a row is reversed at most once (the database refuses a second reversal). */
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Ledger row this reversal undoes' })
  @Column({ type: 'uuid', nullable: true })
  reversalOfId: string | null;

  @ManyToOne(() => WalletTransaction, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reversal_of_id', foreignKeyConstraintName: 'FK_wallet_transactions_reversal_of_id' })
  reversalOf?: WalletTransaction;

  @ApiProperty({ type: Number, description: 'Balance after this change (tiyin)' })
  @Column({ type: 'bigint', transformer: tiyinTransformer })
  balanceAfter: number;
}
