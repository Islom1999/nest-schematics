import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Wallet, WalletTransaction, WalletTransactionType } from '@app/database';

/** 409 `{ code: 'insufficient_funds' }`: the balance is lower than the debit. */
export class InsufficientFundsException extends ConflictException {
  constructor(balance: number, amount: number) {
    super({ message: 'Insufficient balance', code: 'insufficient_funds', balance, amount });
  }
}

export interface WalletEntryOptions {
  /** Ledger type. Default: `topup` for credit, `purchase` for debit. */
  type?: WalletTransactionType;
  /** App reference, e.g. `order:42` (max 128 chars). */
  reference?: string | null;
  /** Human note (admin adjustments). */
  note?: string | null;
  paymentTransactionId?: string | null;
}

/**
 * User balances (`wallets`) with a ledger (`wallet_transactions`). Every
 * change runs in a DB transaction that locks the wallet row
 * (`SELECT ... FOR UPDATE`), so concurrent credits/debits are applied one
 * after another and a debit can never overdraw (the table also has a
 * `balance >= 0` check). Pass `manager` to join a transaction you already
 * run (everything commits or rolls back together):
 *
 *   // buy from balance
 *   await this.dataSource.transaction(async (manager) => {
 *     await this.wallet.debit(user.id, price, { type: WalletTransactionType.PURCHASE, reference: `order:${order.id}` }, manager);
 *     await manager.update(Order, order.id, { status: 'paid' });
 *   });
 *
 * Amounts are positive integers in tiyin.
 */
@Injectable()
export class WalletService {
  constructor(private readonly dataSource: DataSource) {}

  /** Current balance (0 without a wallet). */
  async balance(userId: string, manager: EntityManager = this.dataSource.manager): Promise<number> {
    const wallet = await manager.findOne(Wallet, { where: { userId } });
    return wallet?.balance ?? 0;
  }

  /** Adds `amount` and returns the ledger entry. */
  async credit(userId: string, amount: number, options: WalletEntryOptions = {}, manager?: EntityManager): Promise<WalletTransaction> {
    assertAmount(amount);
    return this.change(userId, amount, { type: WalletTransactionType.TOPUP, ...options }, manager);
  }

  /** Takes `amount`; InsufficientFundsException (409) when the balance is lower. */
  async debit(userId: string, amount: number, options: WalletEntryOptions = {}, manager?: EntityManager): Promise<WalletTransaction> {
    assertAmount(amount);
    return this.change(userId, -amount, { type: WalletTransactionType.PURCHASE, ...options }, manager);
  }

  /** Admin correction: signed amount, with a note. */
  async adjust(userId: string, amount: number, note: string, manager?: EntityManager): Promise<WalletTransaction> {
    if (!Number.isSafeInteger(amount) || amount === 0) throw new BadRequestException('amount must be a non-zero integer (tiyin)');
    return this.change(userId, amount, { type: WalletTransactionType.ADJUST, note }, manager);
  }

  /** Ledger page of a user, newest first. */
  async history(userId: string, page = 1, limit = 20): Promise<{ balance: number; count: number; data: WalletTransaction[] }> {
    const wallet = await this.dataSource.manager.findOne(Wallet, { where: { userId } });
    if (!wallet) return { balance: 0, count: 0, data: [] };
    const [data, count] = await this.dataSource.manager.findAndCount(WalletTransaction, {
      where: { walletId: wallet.id },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { balance: wallet.balance, count, data };
  }

  private async change(userId: string, delta: number, options: WalletEntryOptions, manager?: EntityManager): Promise<WalletTransaction> {
    return this.inTransaction(manager, async (m) => {
      const wallet = await this.lock(m, userId);
      const balance = wallet.balance + delta;
      if (balance < 0) throw new InsufficientFundsException(wallet.balance, -delta);
      await m.update(Wallet, { id: wallet.id }, { balance });
      return m.save(
        m.create(WalletTransaction, {
          walletId: wallet.id,
          amount: delta,
          type: options.type ?? (delta > 0 ? WalletTransactionType.TOPUP : WalletTransactionType.PURCHASE),
          paymentTransactionId: options.paymentTransactionId ?? null,
          reference: options.reference ?? null,
          note: options.note ?? null,
          balanceAfter: balance,
        }),
      );
    });
  }

  /** Creates the wallet on first use, then locks its row until the transaction ends. */
  private async lock(manager: EntityManager, userId: string): Promise<Wallet> {
    await manager.query(
      'INSERT INTO "wallets" ("user_id", "balance") VALUES ($1, 0) ON CONFLICT ("user_id") DO NOTHING',
      [userId],
    );
    const wallet = await manager.findOne(Wallet, { where: { userId }, lock: { mode: 'pessimistic_write' } });
    if (!wallet) throw new Error(`Wallet of user ${userId} not found`);
    return wallet;
  }

  private inTransaction<T>(manager: EntityManager | undefined, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (manager?.queryRunner?.isTransactionActive) return work(manager);
    return (manager ?? this.dataSource.manager).transaction(work);
  }
}

function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new BadRequestException('amount must be a positive integer (tiyin)');
}
