import { ApiProperty } from '@nestjs/swagger';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { tiyinTransformer } from './payment.types';
import { User } from './user.entity';

/**
 * A user's balance (`npm run g -- payment ... --mode wallet`). One row per
 * user, created on the first top-up. Change it only through WalletService
 * (apps/api/src/payments/wallet): every change locks this row and writes a
 * `wallet_transactions` ledger entry. The database refuses a negative balance.
 * Schema: migration `*-wallets.ts` (keep both in sync).
 */
@Entity('wallets')
@Index('UQ_wallets_user_id', ['userId'], { unique: true })
@Check('CHK_wallets_balance_non_negative', '"balance" >= 0')
export class Wallet extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_wallets_user_id' })
  user?: User;

  @ApiProperty({ type: Number, example: 1500000, description: 'Tiyin (1 sum = 100 tiyin), never negative' })
  @Column({ type: 'bigint', transformer: tiyinTransformer })
  balance: number;
}
