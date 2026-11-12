import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Between, DataSource, EntityManager } from 'typeorm';
import {
  INVOICE_NUMBER_START,
  PaymentInvoice,
  PaymentInvoiceStatus,
  PaymentPurpose,
  PaymentStatus,
  PaymentTransaction,
  User,
} from '@app/database';
import { isUniqueViolation } from '../client-auth';
import { applyTransition, PaymentError, TransitionPatch } from './payment-state';
import { PaymentCancelRefusedError, PaymentTarget, PaymentTargetRegistry, WALLET_TARGET } from './payment-target';
import { PaymentSettings, readPaymentSettings } from './payment.settings';

/** What a provider's account value pays for, once checked. */
export interface PayableAccount {
  /** The value the provider sent (invoice number or user account number). */
  account: string;
  amount: number;
  purpose: PaymentPurpose;
  targetType: string;
  targetId: string;
  userId: string;
  /** Null for a direct top-up by account number. */
  invoice: PaymentInvoice | null;
}

export interface NewPaymentTransaction {
  provider: string;
  externalId: string;
  amount: number;
  /** Provider state code of a new (pending) transaction. */
  state: number;
  payable: PayableAccount;
  providerTime?: Date | null;
  raw?: Record<string, unknown>;
}

const DIGITS = /^\d{1,18}$/;

/**
 * Provider-independent payment core used by every provider webhook:
 * - `resolvePayable`: what an account value (invoice number or user account
 *   number) pays for, with the amount and status checks;
 * - `createPending`: a new pending transaction (idempotent per provider id);
 * - `transition`: the state machine (payment-state.ts) with settlement. Each
 *   call runs in one DB transaction holding a `pessimistic_write` lock on the
 *   payment row (and the invoice), so concurrent or repeated callbacks are
 *   applied once. Paying calls `PaymentTarget.onPaid` (wallet credit, order
 *   paid); reversing a paid payment calls `onCancelled`.
 */
@Injectable()
export class PaymentsService {
  readonly settings: PaymentSettings;

  constructor(
    private readonly dataSource: DataSource,
    private readonly targets: PaymentTargetRegistry,
    config: ConfigService,
  ) {
    this.settings = readPaymentSettings(config);
  }

  findByExternalId(provider: string, externalId: string): Promise<PaymentTransaction | null> {
    return this.dataSource.manager.findOne(PaymentTransaction, { where: { provider, externalId } });
  }

  findById(id: string): Promise<PaymentTransaction | null> {
    return this.dataSource.manager.findOne(PaymentTransaction, { where: { id } });
  }

  /** Pending transactions of `provider` for an invoice. */
  pendingForInvoice(invoiceId: string, provider: string, manager: EntityManager = this.dataSource.manager): Promise<PaymentTransaction[]> {
    return manager.find(PaymentTransaction, { where: { invoiceId, provider, status: PaymentStatus.PENDING } });
  }

  /**
   * Checks that `account` can be paid with `amount` (tiyin):
   * - an invoice number (≥ 1 000 000 000): exists, pending, not expired, the
   *   amount matches and its target is still payable;
   * - a user account number (`users.account_no`, wallet mode only): a direct
   *   top-up within PAYMENT_MIN_AMOUNT..PAYMENT_MAX_AMOUNT.
   */
  async resolvePayable(account: string, amount: number, manager: EntityManager = this.dataSource.manager): Promise<PayableAccount> {
    const value = account.trim();
    if (!DIGITS.test(value)) throw new PaymentError('account_not_found', 'Unknown account');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new PaymentError('wrong_amount', 'Invalid amount');

    if (BigInt(value) >= BigInt(INVOICE_NUMBER_START)) {
      const invoice = await manager.findOne(PaymentInvoice, { where: { number: value } });
      if (!invoice) throw new PaymentError('account_not_found', 'Invoice not found');
      if (invoice.status === PaymentInvoiceStatus.PAID) throw new PaymentError('already_paid', 'The invoice is paid');
      if (invoice.status !== PaymentInvoiceStatus.PENDING || invoice.expiresAt.getTime() <= Date.now()) {
        throw new PaymentError('not_payable', 'The invoice is cancelled or expired');
      }
      if (invoice.amount !== amount) throw new PaymentError('wrong_amount', 'The amount does not match the invoice');
      const targetType = invoice.targetType ?? WALLET_TARGET;
      const targetId = invoice.targetId ?? invoice.userId;
      if (invoice.purpose === PaymentPurpose.ORDER) {
        const target = this.targets.get(targetType);
        const info = target ? await target.resolve(targetId, manager) : null;
        if (!info?.payable) throw new PaymentError('not_payable', 'The order cannot be paid now');
      }
      return { account: value, amount, purpose: invoice.purpose, targetType, targetId, userId: invoice.userId, invoice };
    }

    if (!this.targets.has(WALLET_TARGET)) throw new PaymentError('account_not_found', 'Unknown account');
    const user = await manager.findOne(User, { where: { accountNo: value } });
    if (!user || user.isBlocked) throw new PaymentError('account_not_found', 'Unknown account');
    if (amount < this.settings.minAmount || amount > this.settings.maxAmount) {
      throw new PaymentError('wrong_amount', 'The amount is out of the allowed range');
    }
    return {
      account: value,
      amount,
      purpose: PaymentPurpose.TOPUP,
      targetType: WALLET_TARGET,
      targetId: user.id,
      userId: user.id,
      invoice: null,
    };
  }

  /**
   * Stores a new pending transaction. The invoice row is locked and checked
   * again first; `guard` runs inside the same DB transaction (e.g. "no other
   * pending Payme transaction for this invoice"). A repeated provider id
   * returns the stored row.
   */
  async createPending(input: NewPaymentTransaction, guard?: (manager: EntityManager) => Promise<void>): Promise<PaymentTransaction> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const { payable } = input;
        if (payable.invoice) {
          await manager.findOne(PaymentInvoice, { where: { id: payable.invoice.id }, lock: { mode: 'pessimistic_write' } });
          await this.resolvePayable(payable.account, input.amount, manager);
        }
        await guard?.(manager);
        const tx = manager.create(PaymentTransaction, {
          provider: input.provider,
          externalId: input.externalId,
          amount: input.amount,
          state: input.state,
          status: PaymentStatus.PENDING,
          purpose: payable.purpose,
          targetType: payable.targetType,
          targetId: payable.targetId,
          userId: payable.userId,
          invoiceId: payable.invoice?.id ?? null,
          account: payable.account,
          providerTime: input.providerTime ?? null,
          performedAt: null,
          cancelledAt: null,
          reason: null,
          raw: input.raw ?? null,
        });
        const saved = await manager.save(tx);
        // `number` comes from the database sequence.
        return manager.findOneOrFail(PaymentTransaction, { where: { id: saved.id } });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findByExternalId(input.provider, input.externalId);
        if (existing) return existing;
      }
      throw error;
    }
  }

  /**
   * Moves a transaction through the state machine and settles it: `paid`
   * marks the invoice paid and calls `onPaid`; `paid → cancelled` calls
   * `onCancelled` (which may refuse: `cancel_refused`). Moving to the current
   * status changes nothing (repeated callbacks).
   */
  async transition(id: string, to: PaymentStatus, patch: TransitionPatch = {}): Promise<PaymentTransaction> {
    return this.dataSource.transaction(async (manager) => {
      const tx = await manager.findOne(PaymentTransaction, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!tx) throw new PaymentError('transaction_not_found', 'Transaction not found');
      const from = tx.status;
      if (!applyTransition(tx, to, patch)) return tx;
      if (to === PaymentStatus.PAID) await this.settlePaid(tx, manager);
      if (from === PaymentStatus.PAID && to === PaymentStatus.CANCELLED) await this.settleCancelled(tx, manager);
      return manager.save(tx);
    });
  }

  /** Transactions of a provider created (provider time) within [from, to]. */
  statement(provider: string, from: Date, to: Date): Promise<PaymentTransaction[]> {
    return this.dataSource.manager.find(PaymentTransaction, {
      where: { provider, providerTime: Between(from, to) },
      order: { providerTime: 'ASC' },
    });
  }

  listForUser(userId: string, page: number, limit: number): Promise<[PaymentTransaction[], number]> {
    return this.dataSource.manager.findAndCount(PaymentTransaction, {
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  private target(tx: PaymentTransaction): PaymentTarget {
    const type = tx.targetType ?? '';
    const target = this.targets.get(type);
    if (!target) throw new Error(`No payment target "${type}" is registered (payment ${tx.id})`);
    return target;
  }

  private async settlePaid(tx: PaymentTransaction, manager: EntityManager): Promise<void> {
    if (tx.invoiceId) {
      const invoice = await manager.findOne(PaymentInvoice, { where: { id: tx.invoiceId }, lock: { mode: 'pessimistic_write' } });
      if (!invoice) throw new PaymentError('account_not_found', 'Invoice not found');
      if (invoice.status === PaymentInvoiceStatus.PAID) throw new PaymentError('already_paid', 'The invoice is paid');
      if (invoice.status !== PaymentInvoiceStatus.PENDING) throw new PaymentError('not_payable', 'The invoice is cancelled');
      invoice.status = PaymentInvoiceStatus.PAID;
      invoice.paidAt = tx.performedAt;
      await manager.save(invoice);
    }
    await this.target(tx).onPaid(tx.targetId ?? '', tx, manager);
  }

  private async settleCancelled(tx: PaymentTransaction, manager: EntityManager): Promise<void> {
    try {
      await this.target(tx).onCancelled(tx.targetId ?? '', tx, manager);
    } catch (error) {
      if (error instanceof PaymentCancelRefusedError) throw new PaymentError('cancel_refused', error.message);
      throw error;
    }
    if (tx.invoiceId) await manager.update(PaymentInvoice, tx.invoiceId, { status: PaymentInvoiceStatus.CANCELLED });
  }
}
