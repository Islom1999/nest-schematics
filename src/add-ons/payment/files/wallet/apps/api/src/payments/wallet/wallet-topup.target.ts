import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PaymentTransaction, User, WalletTransaction, WalletTransactionType } from '@app/database';
import { PaymentCancelRefusedError, PaymentTarget, PaymentTargetInfo, PaymentTargetRegistry, WALLET_TARGET } from '../payment-target';
import { InsufficientFundsException, WalletService } from './wallet.service';

/**
 * Wallet top-ups as a PaymentTarget (`wallet`, id = user id):
 * - paid → credit the balance (`topup` ledger row);
 * - a paid top-up cancelled by the provider (Payme CancelTransaction after
 *   perform, or an admin after a Click refund) → the credit is reversed
 *   (`reversal` row) when the balance still covers it; when the money is
 *   already spent the cancel is refused (Payme -31007) and the payment stays
 *   paid, so a balance never goes negative.
 */
@Injectable()
export class WalletTopupTarget implements PaymentTarget, OnModuleInit {
  readonly type = WALLET_TARGET;

  constructor(
    private readonly targets: PaymentTargetRegistry,
    private readonly wallet: WalletService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async resolve(userId: string, manager?: EntityManager): Promise<PaymentTargetInfo | null> {
    const user = await (manager ?? this.dataSource.manager).findOne(User, { where: { id: userId } });
    return user ? { amount: 0, userId: user.id, payable: !user.isBlocked } : null;
  }

  async onPaid(userId: string, tx: PaymentTransaction, manager: EntityManager): Promise<void> {
    await this.wallet.credit(userId, tx.amount, { type: WalletTransactionType.TOPUP, paymentTransactionId: tx.id }, manager);
  }

  async onCancelled(userId: string, tx: PaymentTransaction, manager: EntityManager): Promise<void> {
    // Links the reversal to the top-up row: the unique reversal_of_id index then refuses a second one.
    const topup = await manager.findOne(WalletTransaction, {
      where: { paymentTransactionId: tx.id, type: WalletTransactionType.TOPUP },
    });
    try {
      await this.wallet.debit(
        userId,
        tx.amount,
        { type: WalletTransactionType.REVERSAL, paymentTransactionId: tx.id, reversalOfId: topup?.id ?? null },
        manager,
      );
    } catch (error) {
      if (error instanceof InsufficientFundsException) {
        throw new PaymentCancelRefusedError('The top-up is already spent');
      }
      throw error;
    }
  }
}
