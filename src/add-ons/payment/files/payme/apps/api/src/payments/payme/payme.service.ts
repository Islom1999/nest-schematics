import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { PaymentInvoice, PaymentProvider, PaymentStatus, PaymentTransaction } from '@app/database';
import { PaymentProviderAdapter, PaymentProviderRegistry } from '../payment-provider';
import { PaymentError } from '../payment-state';
import { envFlag, envList } from '../payment.settings';
import { PayableAccount, PaymentsService } from '../payments.service';
import { ipAllowed, safeEqual } from '../webhook-security';
import { PaymeError, PaymeErrorCode, paymeErrorFor, PaymeMessage } from './payme.errors';

/** Payme transaction states. */
export const PaymeState = {
  CREATED: 1,
  PERFORMED: 2,
  CANCELLED: -1,
  CANCELLED_AFTER_PERFORM: -2,
} as const;

/** A created transaction that is not performed within 12 hours (of Payme `time`) is cancelled. */
export const PAYME_TIMEOUT_MS = 43_200_000;
/** CancelTransaction reason "cancelled by timeout". */
export const PAYME_REASON_TIMEOUT = 4;

export interface PaymeSettings {
  merchantId: string;
  key: string;
  testKey: string;
  /** Accept PAYME_TEST_KEY too (sandbox, https://test.paycom.uz). */
  testMode: boolean;
  checkoutUrl: string;
  /** Account field configured in the Payme Business cashbox. */
  accountField: string;
  allowedIps: string[];
}

export function readPaymeSettings(config: ConfigService): PaymeSettings {
  const testMode = envFlag(config.get<string>('PAYME_TEST_MODE'));
  const defaultCheckout = testMode ? 'https://checkout.test.paycom.uz' : 'https://checkout.paycom.uz';
  return {
    merchantId: (config.get<string>('PAYME_MERCHANT_ID') ?? '').trim(),
    key: config.get<string>('PAYME_KEY') ?? '',
    testKey: config.get<string>('PAYME_TEST_KEY') ?? '',
    testMode,
    checkoutUrl: (config.get<string>('PAYME_CHECKOUT_URL') || defaultCheckout).replace(/\/+$/, ''),
    accountField: (config.get<string>('PAYME_ACCOUNT_FIELD') || 'account').trim(),
    allowedIps: envList(config.get<string>('PAYME_ALLOWED_IPS')),
  };
}

export interface PaymeResponse {
  jsonrpc: '2.0';
  /** The id of THIS request (never one stored from an earlier request). */
  id: unknown;
  result?: unknown;
  error?: { code: number; message: PaymeMessage; data?: string };
}

type Params = Record<string, unknown>;

function isRecord(value: unknown): value is Params {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ms = (date: Date | null): number => (date ? date.getTime() : 0);

/**
 * Payme Business Merchant API (JSON-RPC 2.0 at `POST /api/payments/payme`):
 * CheckPerformTransaction, CreateTransaction, PerformTransaction,
 * CancelTransaction, CheckTransaction, GetStatement. Every answer is HTTP 200;
 * errors carry Payme codes with ru/uz/en messages. Basic auth
 * `Paycom:<PAYME_KEY>` (also PAYME_TEST_KEY when PAYME_TEST_MODE=true),
 * compared in constant time. Amounts are tiyin.
 *
 * The account (`params.account[PAYME_ACCOUNT_FIELD]`) is an invoice number
 * from checkout, or, in wallet mode, a user account number (`users.account_no`)
 * for a top-up straight from the Payme app.
 *
 * ChangePassword is not supported (-32601): PAYME_KEY lives in the
 * environment; change it in the cabinet and in .env together.
 */
@Injectable()
export class PaymeService implements PaymentProviderAdapter, OnModuleInit {
  readonly provider = PaymentProvider.PAYME;
  readonly manualRefund = false;
  readonly refundHint = 'Refund Payme payments in the Payme Business cabinet: Payme then calls CancelTransaction';
  readonly settings: PaymeSettings;
  private readonly logger = new Logger(PaymeService.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderRegistry,
    config: ConfigService,
  ) {
    this.settings = readPaymeSettings(config);
  }

  onModuleInit(): void {
    this.providers.register(this);
  }

  isConfigured(): boolean {
    return !!this.settings.merchantId && this.keys().length > 0;
  }

  cancelState(paid: boolean): number {
    return paid ? PaymeState.CANCELLED_AFTER_PERFORM : PaymeState.CANCELLED;
  }

  /** `https://checkout.paycom.uz/<base64("m=..;ac.<field>=<invoice>;a=<tiyin>;c=<return url>")>` */
  payUrl(invoice: PaymentInvoice): string {
    const parts = [`m=${this.settings.merchantId}`, `ac.${this.settings.accountField}=${invoice.number}`, `a=${invoice.amount}`];
    const returnUrl = this.payments.settings.returnUrl;
    if (returnUrl) parts.push(`c=${returnUrl.replace(/;/g, '%3B')}`);
    return `${this.settings.checkoutUrl}/${Buffer.from(parts.join(';')).toString('base64')}`;
  }

  /** One JSON-RPC request → one response (always HTTP 200). */
  async handle(body: unknown, authorization: string | undefined, ip: string): Promise<PaymeResponse> {
    const request = isRecord(body) ? body : null;
    const id = request?.id ?? null;
    try {
      if (!this.authorized(authorization, ip)) throw new PaymeError(PaymeErrorCode.INSUFFICIENT_PRIVILEGE);
      if (!request || typeof request.method !== 'string') throw new PaymeError(PaymeErrorCode.INVALID_REQUEST);
      const params = request.params ?? {};
      if (!isRecord(params)) throw new PaymeError(PaymeErrorCode.INVALID_REQUEST);
      const result = await this.dispatch(request.method, params, id);
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      let payme: PaymeError;
      if (error instanceof PaymeError) payme = error;
      else if (error instanceof PaymentError) payme = paymeErrorFor(error.code, this.settings.accountField);
      else {
        this.logger.error(`Payme ${String(request?.method)}: ${(error as Error)?.message}`, (error as Error)?.stack);
        payme = new PaymeError(PaymeErrorCode.SYSTEM_ERROR);
      }
      return { jsonrpc: '2.0', id, error: payme.toJSON() };
    }
  }

  private dispatch(method: string, params: Params, rpcId: unknown): Promise<unknown> {
    switch (method) {
      case 'CheckPerformTransaction':
        return this.checkPerform(params);
      case 'CreateTransaction':
        return this.create(params, rpcId);
      case 'PerformTransaction':
        return this.perform(params, rpcId);
      case 'CancelTransaction':
        return this.cancel(params, rpcId);
      case 'CheckTransaction':
        return this.check(params);
      case 'GetStatement':
        return this.statement(params);
      default:
        // ChangePassword included: the key is managed in .env.
        throw new PaymeError(PaymeErrorCode.METHOD_NOT_FOUND, method);
    }
  }

  // ── Methods ────────────────────────────────────────────────────────────

  private async checkPerform(params: Params): Promise<{ allow: true }> {
    const amount = this.amountOf(params);
    const payable = await this.payments.resolvePayable(this.accountOf(params), amount);
    await this.assertNotBusy(payable);
    return { allow: true };
  }

  private async create(params: Params, rpcId: unknown) {
    const externalId = this.idOf(params);
    const time = params.time;
    if (typeof time !== 'number' || !Number.isFinite(time)) throw new PaymeError(PaymeErrorCode.INVALID_REQUEST);
    const amount = this.amountOf(params);
    const account = this.accountOf(params);

    const existing = await this.payments.findByExternalId(this.provider, externalId);
    if (existing) return this.createdResult(await this.assertStillCreated(existing));

    if (Date.now() - time >= PAYME_TIMEOUT_MS) throw new PaymeError(PaymeErrorCode.CANNOT_PERFORM);
    const payable = await this.payments.resolvePayable(account, amount);
    const tx = await this.payments.createPending(
      {
        provider: this.provider,
        externalId,
        amount,
        state: PaymeState.CREATED,
        payable,
        providerTime: new Date(time),
        raw: { create: { rpcId, time, account: params.account, at: new Date().toISOString() } },
      },
      (manager) => this.assertNotBusy(payable, manager, externalId),
    );
    // A concurrent request with the same id may have created it first.
    return this.createdResult(await this.assertStillCreated(tx));
  }

  private async perform(params: Params, rpcId: unknown) {
    const tx = await this.find(params);
    if (tx.state === PaymeState.PERFORMED) return this.performedResult(tx);
    if (tx.state !== PaymeState.CREATED) throw new PaymeError(PaymeErrorCode.CANNOT_PERFORM);
    if (this.expired(tx)) {
      await this.cancelByTimeout(tx);
      throw new PaymeError(PaymeErrorCode.CANNOT_PERFORM);
    }
    try {
      const done = await this.payments.transition(tx.id, PaymentStatus.PAID, {
        state: PaymeState.PERFORMED,
        onlyFrom: [PaymentStatus.PENDING],
        raw: { perform: { rpcId, at: new Date().toISOString() } },
      });
      return this.performedResult(done);
    } catch (error) {
      if (error instanceof PaymentError) throw new PaymeError(PaymeErrorCode.CANNOT_PERFORM);
      throw error;
    }
  }

  private async cancel(params: Params, rpcId: unknown) {
    const tx = await this.find(params);
    const reason = params.reason;
    if (typeof reason !== 'number' || !Number.isInteger(reason)) throw new PaymeError(PaymeErrorCode.INVALID_REQUEST);
    if (tx.state !== PaymeState.CREATED && tx.state !== PaymeState.PERFORMED) return this.cancelledResult(tx);
    try {
      const done = await this.payments.transition(tx.id, PaymentStatus.CANCELLED, {
        state: (from) => this.cancelState(from === PaymentStatus.PAID),
        reason,
        raw: { cancel: { rpcId, reason, at: new Date().toISOString() } },
      });
      return this.cancelledResult(done);
    } catch (error) {
      if (error instanceof PaymentError) {
        throw new PaymeError(error.code === 'cancel_refused' ? PaymeErrorCode.CANNOT_CANCEL : PaymeErrorCode.CANNOT_PERFORM);
      }
      throw error;
    }
  }

  private async check(params: Params) {
    const tx = await this.find(params);
    return {
      create_time: ms(tx.createdAt),
      perform_time: ms(tx.performedAt),
      cancel_time: ms(tx.cancelledAt),
      transaction: tx.number,
      state: tx.state,
      reason: tx.reason,
    };
  }

  private async statement(params: Params) {
    const { from, to } = params;
    if (typeof from !== 'number' || typeof to !== 'number') throw new PaymeError(PaymeErrorCode.INVALID_REQUEST);
    const rows = await this.payments.statement(this.provider, new Date(from), new Date(to));
    return {
      transactions: rows.map((tx) => ({
        id: tx.externalId,
        time: ms(tx.providerTime),
        amount: tx.amount,
        account: { [this.settings.accountField]: tx.account },
        create_time: ms(tx.createdAt),
        perform_time: ms(tx.performedAt),
        cancel_time: ms(tx.cancelledAt),
        transaction: tx.number,
        state: tx.state,
        reason: tx.reason,
      })),
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private createdResult(tx: PaymentTransaction) {
    return { create_time: ms(tx.createdAt), transaction: tx.number, state: tx.state };
  }

  private performedResult(tx: PaymentTransaction) {
    return { transaction: tx.number, perform_time: ms(tx.performedAt), state: tx.state };
  }

  private cancelledResult(tx: PaymentTransaction) {
    return { transaction: tx.number, cancel_time: ms(tx.cancelledAt), state: tx.state };
  }

  /** A repeated CreateTransaction: only a live created transaction is answered again. */
  private async assertStillCreated(tx: PaymentTransaction): Promise<PaymentTransaction> {
    if (tx.state !== PaymeState.CREATED) throw new PaymeError(PaymeErrorCode.CANNOT_PERFORM);
    if (this.expired(tx)) {
      await this.cancelByTimeout(tx);
      throw new PaymeError(PaymeErrorCode.CANNOT_PERFORM);
    }
    return tx;
  }

  private expired(tx: PaymentTransaction): boolean {
    return !!tx.providerTime && Date.now() - tx.providerTime.getTime() > PAYME_TIMEOUT_MS;
  }

  private async cancelByTimeout(tx: PaymentTransaction): Promise<void> {
    try {
      await this.payments.transition(tx.id, PaymentStatus.CANCELLED, {
        state: PaymeState.CANCELLED,
        reason: PAYME_REASON_TIMEOUT,
        onlyFrom: [PaymentStatus.PENDING],
        raw: { timeout: { at: new Date().toISOString() } },
      });
    } catch (error) {
      if (!(error instanceof PaymentError)) throw error;
    }
  }

  /** One-time invoices accept one live Payme transaction at a time. */
  private async assertNotBusy(payable: PayableAccount, manager?: EntityManager, exceptExternalId?: string): Promise<void> {
    if (!payable.invoice) return;
    const pending = await this.payments.pendingForInvoice(payable.invoice.id, this.provider, manager);
    if (pending.some((tx) => tx.externalId !== exceptExternalId && !this.expired(tx))) {
      throw new PaymentError('busy', 'Another Payme transaction is waiting for this invoice');
    }
  }

  private async find(params: Params): Promise<PaymentTransaction> {
    const tx = await this.payments.findByExternalId(this.provider, this.idOf(params));
    if (!tx) throw new PaymeError(PaymeErrorCode.TRANSACTION_NOT_FOUND);
    return tx;
  }

  private idOf(params: Params): string {
    const id = params.id;
    if (typeof id !== 'string' || !id || id.length > 64) throw new PaymeError(PaymeErrorCode.INVALID_REQUEST);
    return id;
  }

  private amountOf(params: Params): number {
    const amount = params.amount;
    if (typeof amount !== 'number') throw new PaymeError(PaymeErrorCode.INVALID_REQUEST);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new PaymeError(PaymeErrorCode.WRONG_AMOUNT);
    return amount;
  }

  private accountOf(params: Params): string {
    const field = this.settings.accountField;
    const value = isRecord(params.account) ? params.account[field] : undefined;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    throw new PaymeError(PaymeErrorCode.ACCOUNT_NOT_FOUND, field);
  }

  private keys(): string[] {
    return [this.settings.key, this.settings.testMode ? this.settings.testKey : ''].filter((k) => k.length > 0);
  }

  /** Basic `Paycom:<key>` from an allowed IP. Unset keys = every request is refused. */
  private authorized(header: string | undefined, ip: string): boolean {
    if (!ipAllowed(this.settings.allowedIps, ip)) return false;
    const keys = this.keys();
    if (!keys.length) return false;
    const [scheme, encoded] = (header ?? '').trim().split(/\s+/);
    if (scheme?.toLowerCase() !== 'basic' || !encoded) return false;
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 0) return false;
    const password = decoded.slice(colon + 1);
    let match = false;
    for (const key of keys) match = safeEqual(password, key) || match;
    return match && decoded.slice(0, colon) === 'Paycom';
  }
}
