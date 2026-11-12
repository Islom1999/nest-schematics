import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Generated, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { PaymentInvoice } from './payment-invoice.entity';
import { PaymentPurpose, PaymentStatus, tiyinTransformer } from './payment.types';
import { User } from './user.entity';

/**
 * One provider transaction (a Payme transaction, a Click payment...).
 * `externalId` is the provider's id, unique per provider, so repeated
 * callbacks find the same row. `status` follows the provider-independent state
 * machine (apps/api/src/payments/payment-state.ts); `state` keeps the
 * provider's own code (Payme 1 / 2 / -1 / -2, Click 0 / 1 / -1).
 * Schema: migration `*-payments.ts` (keep both in sync).
 */
@Entity('payment_transactions')
@Index('UQ_payment_transactions_provider_external_id', ['provider', 'externalId'], { unique: true })
@Index('UQ_payment_transactions_number', ['number'], { unique: true })
@Index('IDX_payment_transactions_user_id', ['userId'])
@Index('IDX_payment_transactions_invoice_id', ['invoiceId'])
@Index('IDX_payment_transactions_provider_time', ['provider', 'providerTime'])
export class PaymentTransaction extends BaseEntity {
  /** Our transaction number (Payme `transaction`, Click `merchant_prepare_id`). bigint as a string. */
  @ApiProperty({ type: String, example: '1' })
  @Column({ type: 'bigint' })
  @Generated('increment')
  number: string;

  @ApiProperty({ type: String, example: 'payme' })
  @Column({ type: 'varchar', length: 20 })
  provider: string;

  @ApiProperty({ type: String, description: 'Transaction id in the provider system' })
  @Column({ type: 'varchar', length: 64 })
  externalId: string;

  @ApiProperty({ type: Number, example: 1500000, description: 'Tiyin (1 sum = 100 tiyin)' })
  @Column({ type: 'bigint', transformer: tiyinTransformer })
  amount: number;

  @ApiProperty({ type: Number, description: 'Provider state code (Payme 1, 2, -1, -2; Click 0, 1, -1)' })
  @Column({ type: 'int' })
  state: number;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  @Column({ type: 'varchar', length: 16 })
  status: PaymentStatus;

  @ApiProperty({ enum: PaymentPurpose, enumName: 'PaymentPurpose' })
  @Column({ type: 'varchar', length: 16 })
  purpose: PaymentPurpose;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'wallet', description: 'PaymentTarget type' })
  @Column({ type: 'varchar', length: 64, nullable: true })
  targetType: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  targetId: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_payment_transactions_user_id' })
  user?: User;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @Column({ type: 'uuid', nullable: true })
  invoiceId: string | null;

  @ManyToOne(() => PaymentInvoice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invoice_id', foreignKeyConstraintName: 'FK_payment_transactions_invoice_id' })
  invoice?: PaymentInvoice;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Account value the provider sent: invoice number or user account number' })
  @Column({ type: 'varchar', length: 64, nullable: true })
  account: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Creation time in the provider system (Payme `time`)' })
  @Column({ type: 'timestamptz', nullable: true })
  providerTime: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  performedAt: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Provider cancel reason / error code' })
  @Column({ type: 'int', nullable: true })
  reason: number | null;

  /** Provider requests per step (`create`, `perform`, `prepare`...), each with its own request id. Admin only. */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown> | null;
}
