import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PaymentInvoice, PaymentProvider, PaymentStatus, PaymentTransaction } from '@app/database';
import { PaymentProviderAdapter, PaymentProviderRegistry } from '../payment-provider';
import { PaymentError } from '../payment-state';
import { envList } from '../payment.settings';
import { PaymentsService } from '../payments.service';
import { ipAllowed, safeEqual } from '../webhook-security';
import { PaynetError, PaynetErrorCode, paynetErrorFor } from './paynet.errors';

/** States stored in `payment_transactions.state` (1 and 2 are Paynet's `transactionState`). */
export const PaynetState = {
  PENDING: 0,
  SUCCESS: 1,
  CANCELLED: 2,
  FAILED: -1,
} as const;

export interface PaynetSettings {
  login: string;
  password: string;
  /** Optional: when set, `params.serviceId` must match. */
  serviceId: string;
  /** Key of the account value in `params.fields`. */
  accountField: string;
  /** Optional pay link template: {account}, {amount} (tiyin), {sum}. Empty = pay by account in the Paynet app. */
  payUrl: string;
  allowedIps: string[];
}

export function readPaynetSettings(config: ConfigService): PaynetSettings {
  return {
    login: config.get<string>('PAYNET_LOGIN') ?? '',
    password: config.get<string>('PAYNET_PASSWORD') ?? '',
    serviceId: (config.get<string>('PAYNET_SERVICE_ID') ?? '').trim(),
    accountField: (config.get<string>('PAYNET_ACCOUNT_FIELD') || 'account').trim(),
    payUrl: (config.get<string>('PAYNET_PAY_URL') ?? '').trim(),
    allowedIps: envList(config.get<string>('PAYNET_ALLOWED_IPS')),
  };
}

export interface PaynetResponse {
  jsonrpc: '2.0';
  /** The id of THIS request. */
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

type Params = Record<string, unknown>;

function isRecord(value: unknown): value is Params {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string or a finite number as text, else null. */
function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Paynet times are `YYYY-MM-DD HH:mm:ss` in Tashkent time (UTC+5, no DST). */
const TASHKENT_OFFSET_MS = 5 * 3_600_000;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export function formatPaynetTime(date: Date | null): string | null {
  if (!date) return null;
  return new Date(date.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

export function parsePaynetTime(value: unknown): Date | null {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = DATETIME.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(utc - TASHKENT_OFFSET_MS);
  // Reject 2026-02-31 and the like.
  return formatPaynetTime(date) === text ? date : null;
}

/** Numeric ids go back as numbers, like Paynet sent them. */
const idValue = (id: string): number | string => (/^\d{1,15}$/.test(id) ? Number(id) : id);

/**
 * Paynet provider API (JSON-RPC 2.0 at `POST /api/payments/paynet`):
 * GetInformation, PerformTransaction, CheckTransaction, CancelTransaction,
 * GetStatement. Always HTTP 200; errors carry Paynet codes. Basic auth
 * `PAYNET_LOGIN:PAYNET_PASSWORD`, compared in constant time. Amounts are tiyin.
 *
 * `params.fields[PAYNET_ACCOUNT_FIELD]` is an invoice number from checkout or,
 * in wallet mode, a user account number (`users.account_no`).
 *
 * PerformTransaction creates and pays in one step. A repeated transactionId is
 * refused with 201 and changes nothing; a repeated cancel answers 202. The
 * state machine runs under a row lock (PaymentsService), so concurrent calls
 * credit once.
 */
@Injectable()
export class PaynetService implements PaymentProviderAdapter, OnModuleInit {
  readonly provider = PaymentProvider.PAYNET;
  readonly manualRefund = false;
  readonly refundHint = 'Refund Paynet payments through Paynet: Paynet then calls CancelTransaction';
  readonly settings: PaynetSettings;
  private readonly logger = new Logger(PaynetService.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderRegistry,
    config: ConfigService,
  ) {
    this.settings = readPaynetSettings(config);
  }

  onModuleInit(): void {
    this.providers.register(this);
  }

  isConfigured(): boolean {
    return !!this.settings.login && !!this.settings.password;
  }

  cancelState(): number {
    return PaynetState.CANCELLED;
  }

  /** PAYNET_PAY_URL with {account}, {amount} (tiyin) and {sum} filled in; empty when not set. */
  payUrl(invoice: PaymentInvoice): string {
    return this.settings.payUrl
      .replace(/\{account\}/g, encodeURIComponent(invoice.number))
      .replace(/\{amount\}/g, String(invoice.amount))
      .replace(/\{sum\}/g, (invoice.amount / 100).toFixed(2));
  }

  /** One JSON-RPC request → one response (always HTTP 200). */
  async handle(body: unknown, authorization: string | undefined, ip: string): Promise<PaynetResponse> {
    const request = isRecord(body) ? body : null;
    const id = request?.id ?? null;
    try {
      if (!this.isConfigured() || !ipAllowed(this.settings.allowedIps, ip)) throw new PaynetError(PaynetErrorCode.ACCESS_DENIED);
      if (!this.authorized(authorization)) throw new PaynetError(PaynetErrorCode.WRONG_LOGIN);
      if (!request || typeof request.method !== 'string') throw new PaynetError(PaynetErrorCode.INVALID_REQUEST);
      const params = request.params ?? {};
      if (!isRecord(params)) throw new PaynetError(PaynetErrorCode.INVALID_REQUEST);
      if (this.settings.serviceId && params.serviceId !== undefined && scalarText(params.serviceId) !== this.settings.serviceId) {
        throw new PaynetError(PaynetErrorCode.ACCESS_DENIED, 'Unknown serviceId');
      }
      const result = await this.dispatch(request.method, params);
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      let paynet: PaynetError;
      if (error instanceof PaynetError) paynet = error;
      else if (error instanceof PaymentError) paynet = paynetErrorFor(error.code, error.message);
      else {
        this.logger.error(`Paynet ${String(request?.method)}: ${(error as Error)?.message}`, (error as Error)?.stack);
        paynet = new PaynetError(PaynetErrorCode.SYSTEM_ERROR);
      }
      return { jsonrpc: '2.0', id, error: paynet.toJSON() };
    }
  }

  private dispatch(method: string, params: Params): Promise<unknown> {
    switch (method) {
      case 'GetInformation':
        return this.information(params);
      case 'PerformTransaction':
        return this.perform(params);
      case 'CheckTransaction':
        return this.check(params);
      case 'CancelTransaction':
        return this.cancel(params);
      case 'GetStatement':
        return this.statement(params);
      default:
        // ChangePassword included: the password lives in .env.
        throw new PaynetError(PaynetErrorCode.METHOD_NOT_FOUND);
    }
  }

  // ── Methods ────────────────────────────────────────────────────────────

  /** Is the account payable (no amount yet). Answers only the account value, nothing private. */
  private async information(params: Params) {
    const account = this.accountOf(params);
    try {
      await this.payments.resolvePayable(account, this.payments.settings.minAmount);
    } catch (error) {
      // The amount is checked by PerformTransaction; here only the account matters.
      if (!(error instanceof PaymentError && error.code === 'wrong_amount')) throw error;
    }
    return { status: '0', timestamp: formatPaynetTime(new Date()), fields: { [this.settings.accountField]: account } };
  }

  private async perform(params: Params) {
    const transactionId = this.idOf(params);
    const amount = this.amountOf(params);
    const account = this.accountOf(params);
    const providerTime = params.timestamp === undefined ? new Date() : parsePaynetTime(params.timestamp);
    if (!providerTime) throw new PaynetError(PaynetErrorCode.WRONG_DATETIME);

    if (await this.payments.findByExternalId(this.provider, transactionId)) throw new PaynetError(PaynetErrorCode.TRANSACTION_EXISTS);
    const payable = await this.payments.resolvePayable(account, amount);
    const nonce = randomUUID();
    const tx = await this.payments.createPending({
      provider: this.provider,
      externalId: transactionId,
      amount,
      state: PaynetState.PENDING,
      payable,
      providerTime,
      raw: { perform: { nonce, timestamp: params.timestamp, serviceId: params.serviceId, at: new Date().toISOString() } },
    });
    // A concurrent PerformTransaction with the same id stored it first: this one is a repeat.
    const stored = tx.raw?.perform as { nonce?: string } | undefined;
    if (stored?.nonce !== nonce) throw new PaynetError(PaynetErrorCode.TRANSACTION_EXISTS);

    try {
      const done = await this.payments.transition(tx.id, PaymentStatus.PAID, { state: PaynetState.SUCCESS, onlyFrom: [PaymentStatus.PENDING] });
      return {
        providerTrnId: Number(done.number),
        timestamp: formatPaynetTime(done.performedAt),
        fields: { [this.settings.accountField]: account },
      };
    } catch (error) {
      // Not paid (the invoice was paid meanwhile...): the transaction ends as failed.
      if (error instanceof PaymentError) {
        await this.payments
          .transition(tx.id, PaymentStatus.FAILED, { state: PaynetState.FAILED, onlyFrom: [PaymentStatus.PENDING] })
          .catch((e: unknown) => {
            if (!(e instanceof PaymentError)) throw e;
          });
      }
      throw error;
    }
  }

  private async check(params: Params) {
    const tx = await this.find(params);
    if (tx.status === PaymentStatus.PAID) {
      return { transactionState: PaynetState.SUCCESS, timestamp: formatPaynetTime(tx.performedAt), providerTrnId: Number(tx.number) };
    }
    if (tx.status === PaymentStatus.CANCELLED) {
      return { transactionState: PaynetState.CANCELLED, timestamp: formatPaynetTime(tx.cancelledAt), providerTrnId: Number(tx.number) };
    }
    // Pending (perform still running) or failed: not a performed transaction.
    throw new PaynetError(PaynetErrorCode.TRANSACTION_NOT_FOUND);
  }

  private async cancel(params: Params) {
    const tx = await this.find(params);
    if (tx.status === PaymentStatus.CANCELLED) throw new PaynetError(PaynetErrorCode.TRANSACTION_CANCELLED);
    if (tx.status === PaymentStatus.FAILED) throw new PaynetError(PaynetErrorCode.TRANSACTION_NOT_FOUND);
    const done = await this.payments.transition(tx.id, PaymentStatus.CANCELLED, {
      state: PaynetState.CANCELLED,
      onlyFrom: [PaymentStatus.PENDING, PaymentStatus.PAID],
      raw: { cancel: { timestamp: params.timestamp, at: new Date().toISOString() } },
    });
    return { providerTrnId: Number(done.number), timestamp: formatPaynetTime(done.cancelledAt), transactionState: PaynetState.CANCELLED };
  }

  /** Performed transactions whose Paynet time is within [dateFrom, dateTo]. */
  private async statement(params: Params) {
    const from = parsePaynetTime(params.dateFrom);
    const to = parsePaynetTime(params.dateTo);
    if (params.dateFrom === undefined || params.dateTo === undefined) throw new PaynetError(PaynetErrorCode.MISSING_PARAMS);
    if (!from || !to) throw new PaynetError(PaynetErrorCode.WRONG_DATETIME);
    const rows = await this.payments.statement(this.provider, from, to);
    return {
      statements: rows
        .filter((tx) => tx.status === PaymentStatus.PAID)
        .map((tx) => ({
          amount: tx.amount,
          providerTrnId: Number(tx.number),
          transactionId: idValue(tx.externalId),
          timestamp: formatPaynetTime(tx.providerTime),
        })),
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async find(params: Params): Promise<PaymentTransaction> {
    const tx = await this.payments.findByExternalId(this.provider, this.idOf(params));
    if (!tx) throw new PaynetError(PaynetErrorCode.TRANSACTION_NOT_FOUND);
    return tx;
  }

  private idOf(params: Params): string {
    const id = params.transactionId;
    if (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) return String(id);
    if (typeof id === 'string' && id.trim() && id.length <= 64) return id.trim();
    throw new PaynetError(PaynetErrorCode.MISSING_PARAMS, 'transactionId');
  }

  /** `amount` in tiyin: a positive safe integer. */
  private amountOf(params: Params): number {
    const amount = params.amount;
    if (amount === undefined || amount === null) throw new PaynetError(PaynetErrorCode.MISSING_PARAMS, 'amount');
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) throw new PaynetError(PaynetErrorCode.WRONG_AMOUNT);
    return amount;
  }

  private accountOf(params: Params): string {
    const value = isRecord(params.fields) ? params.fields[this.settings.accountField] : undefined;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    throw new PaynetError(PaynetErrorCode.MISSING_PARAMS, this.settings.accountField);
  }

  /** Basic `PAYNET_LOGIN:PAYNET_PASSWORD`, both compared in constant time. */
  private authorized(header: string | undefined): boolean {
    const [scheme, encoded] = (header ?? '').trim().split(/\s+/);
    if (scheme?.toLowerCase() !== 'basic' || !encoded) return false;
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 0) return false;
    const loginOk = safeEqual(decoded.slice(0, colon), this.settings.login);
    const passwordOk = safeEqual(decoded.slice(colon + 1), this.settings.password);
    return loginOk && passwordOk;
  }
}
