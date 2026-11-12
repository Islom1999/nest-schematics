import { EntityManager } from 'typeorm';
import {
  INVOICE_NUMBER_START,
  PaymentInvoice,
  PaymentInvoiceStatus,
  PaymentPurpose,
  PaymentStatus,
  PaymentTransaction,
} from '@app/database';
import { applyTransition, PaymentError, TransitionPatch } from '../payment-state';
import { WALLET_TARGET } from '../payment-target';
import { PaymentSettings } from '../payment.settings';
import { NewPaymentTransaction, PayableAccount, PaymentsService } from '../payments.service';

/**
 * In-memory PaymentsService for provider specs (no database). It uses the
 * real state machine (applyTransition) and simulates the wallet target:
 * paying credits `balances`, cancelling a paid payment debits it and is
 * refused (`cancel_refused`) when the balance is lower, like WalletTopupTarget.
 *
 *   const fake = new FakePayments();
 *   const service = new PaymeService(fake.asService(), new PaymentProviderRegistry(), config);
 */
export class FakePayments {
  readonly settings: PaymentSettings = { minAmount: 100_000, maxAmount: 1_000_000_000, invoiceTtlMinutes: 1440, returnUrl: '' };
  readonly invoices: PaymentInvoice[] = [];
  readonly transactions: PaymentTransaction[] = [];
  /** users.account_no → user id */
  readonly users = new Map<string, string>();
  /** user id → wallet balance (tiyin) */
  readonly balances = new Map<string, number>();
  private seq = 0;
  private txSeq = 0;
  private invoiceSeq = INVOICE_NUMBER_START;

  asService(): PaymentsService {
    return this as unknown as PaymentsService;
  }

  addUser(accountNo: string, id = `user-${accountNo}`): string {
    this.users.set(accountNo, id);
    return id;
  }

  addInvoice(userId: string, amount: number, patch: Partial<PaymentInvoice> = {}): PaymentInvoice {
    const invoice = Object.assign(new PaymentInvoice(), {
      id: `invoice-${++this.seq}`,
      number: String(this.invoiceSeq++),
      userId,
      amount,
      purpose: PaymentPurpose.TOPUP,
      targetType: WALLET_TARGET,
      targetId: userId,
      status: PaymentInvoiceStatus.PENDING,
      provider: 'payme',
      expiresAt: new Date(Date.now() + 86_400_000),
      paidAt: null,
      ...patch,
    });
    this.invoices.push(invoice);
    return invoice;
  }

  balance(userId: string): number {
    return this.balances.get(userId) ?? 0;
  }

  async findByExternalId(provider: string, externalId: string): Promise<PaymentTransaction | null> {
    return this.copy(this.transactions.find((t) => t.provider === provider && t.externalId === externalId));
  }

  async findById(id: string): Promise<PaymentTransaction | null> {
    return this.copy(this.transactions.find((t) => t.id === id));
  }

  async pendingForInvoice(invoiceId: string, provider: string): Promise<PaymentTransaction[]> {
    return this.transactions.filter((t) => t.invoiceId === invoiceId && t.provider === provider && t.status === PaymentStatus.PENDING);
  }

  async resolvePayable(account: string, amount: number): Promise<PayableAccount> {
    if (!/^\d{1,18}$/.test(account)) throw new PaymentError('account_not_found', 'Unknown account');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new PaymentError('wrong_amount', 'Invalid amount');
    if (Number(account) >= INVOICE_NUMBER_START) {
      const invoice = this.invoices.find((i) => i.number === account);
      if (!invoice) throw new PaymentError('account_not_found', 'Invoice not found');
      if (invoice.status === PaymentInvoiceStatus.PAID) throw new PaymentError('already_paid', 'The invoice is paid');
      if (invoice.status !== PaymentInvoiceStatus.PENDING || invoice.expiresAt.getTime() <= Date.now()) {
        throw new PaymentError('not_payable', 'The invoice is cancelled or expired');
      }
      if (invoice.amount !== amount) throw new PaymentError('wrong_amount', 'The amount does not match the invoice');
      return {
        account,
        amount,
        purpose: invoice.purpose,
        targetType: invoice.targetType ?? WALLET_TARGET,
        targetId: invoice.targetId ?? invoice.userId,
        userId: invoice.userId,
        invoice,
      };
    }
    const userId = this.users.get(account);
    if (!userId) throw new PaymentError('account_not_found', 'Unknown account');
    if (amount < this.settings.minAmount || amount > this.settings.maxAmount) throw new PaymentError('wrong_amount', 'Out of range');
    return { account, amount, purpose: PaymentPurpose.TOPUP, targetType: WALLET_TARGET, targetId: userId, userId, invoice: null };
  }

  async createPending(input: NewPaymentTransaction, guard?: (manager: EntityManager) => Promise<void>): Promise<PaymentTransaction> {
    const existing = await this.findByExternalId(input.provider, input.externalId);
    if (existing) return existing;
    const { payable } = input;
    if (payable.invoice) await this.resolvePayable(payable.account, input.amount);
    await guard?.({} as EntityManager);
    const now = new Date();
    const tx = Object.assign(new PaymentTransaction(), {
      id: `tx-${++this.txSeq}`,
      number: String(this.txSeq),
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
      createdAt: now,
      updatedAt: now,
    });
    this.transactions.push(tx);
    return this.copy(tx)!;
  }

  /** Like PaymentsService.transition: all or nothing. */
  async transition(id: string, to: PaymentStatus, patch: TransitionPatch = {}): Promise<PaymentTransaction> {
    const stored = this.transactions.find((t) => t.id === id);
    if (!stored) throw new PaymentError('transaction_not_found', 'Transaction not found');
    const tx = this.copy(stored)!;
    const from = tx.status;
    if (!applyTransition(tx, to, patch)) return tx;
    const invoice = tx.invoiceId ? this.invoices.find((i) => i.id === tx.invoiceId) : undefined;
    const userId = tx.targetId ?? '';
    if (to === PaymentStatus.PAID) {
      if (invoice && invoice.status !== PaymentInvoiceStatus.PENDING) {
        throw new PaymentError(invoice.status === PaymentInvoiceStatus.PAID ? 'already_paid' : 'not_payable', 'Invoice is not payable');
      }
      if (invoice) Object.assign(invoice, { status: PaymentInvoiceStatus.PAID, paidAt: tx.performedAt });
      this.balances.set(userId, this.balance(userId) + tx.amount);
    }
    if (from === PaymentStatus.PAID && to === PaymentStatus.CANCELLED) {
      if (this.balance(userId) < tx.amount) throw new PaymentError('cancel_refused', 'The top-up is already spent');
      this.balances.set(userId, this.balance(userId) - tx.amount);
      if (invoice) invoice.status = PaymentInvoiceStatus.CANCELLED;
    }
    Object.assign(stored, tx);
    return this.copy(stored)!;
  }

  async statement(provider: string, from: Date, to: Date): Promise<PaymentTransaction[]> {
    return this.transactions
      .filter((t) => t.provider === provider && t.providerTime && t.providerTime >= from && t.providerTime <= to)
      .sort((a, b) => a.providerTime!.getTime() - b.providerTime!.getTime())
      .map((t) => this.copy(t)!);
  }

  private copy(tx: PaymentTransaction | undefined): PaymentTransaction | null {
    return tx ? Object.assign(new PaymentTransaction(), tx, { raw: tx.raw ? { ...tx.raw } : null }) : null;
  }
}
