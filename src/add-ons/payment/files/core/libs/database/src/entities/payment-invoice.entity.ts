import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Generated, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { PaymentInvoiceStatus, PaymentPurpose, tiyinTransformer } from './payment.types';
import { User } from './user.entity';

/** Invoice numbers start here; user account numbers (users.account_no) stay below it. */
export const INVOICE_NUMBER_START = 1_000_000_000;

/**
 * What a user is about to pay (`POST client/payments/checkout`). The provider's
 * account parameter (Payme `ac.<PAYME_ACCOUNT_FIELD>`, Click
 * `merchant_trans_id`) is the invoice `number`. One invoice is paid once;
 * expired invoices accept no new provider transactions.
 * Schema: migration `*-payments.ts` (keep both in sync).
 */
@Entity('payment_invoices')
@Index('UQ_payment_invoices_number', ['number'], { unique: true })
@Index('IDX_payment_invoices_user_id', ['userId'])
export class PaymentInvoice extends BaseEntity {
  /** bigint comes back as a string. */
  @ApiProperty({ type: String, example: '1000000001', description: 'Account value sent to the provider' })
  @Column({ type: 'bigint' })
  @Generated('increment')
  number: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_payment_invoices_user_id' })
  user?: User;

  @ApiProperty({ type: Number, example: 1500000, description: 'Tiyin (1 sum = 100 tiyin)' })
  @Column({ type: 'bigint', transformer: tiyinTransformer })
  amount: number;

  @ApiProperty({ enum: PaymentPurpose, enumName: 'PaymentPurpose' })
  @Column({ type: 'varchar', length: 16 })
  purpose: PaymentPurpose;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'wallet', description: 'PaymentTarget type' })
  @Column({ type: 'varchar', length: 64, nullable: true })
  targetType: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  targetId: string | null;

  @ApiProperty({ enum: PaymentInvoiceStatus, enumName: 'PaymentInvoiceStatus' })
  @Column({ type: 'varchar', length: 16 })
  status: PaymentInvoiceStatus;

  @ApiProperty({ type: String, example: 'payme', description: 'Provider chosen at checkout' })
  @Column({ type: 'varchar', length: 20 })
  provider: string;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;
}
