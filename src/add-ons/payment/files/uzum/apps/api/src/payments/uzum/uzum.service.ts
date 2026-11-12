import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentInvoice, PaymentProvider, PaymentStatus, PaymentTransaction } from '@app/database';
import { PaymentProviderAdapter, PaymentProviderRegistry } from '../payment-provider';
import { PaymentError } from '../payment-state';
import { envList } from '../payment.settings';
import { PaymentsService } from '../payments.service';
import { ipAllowed, safeEqual } from '../webhook-security';
import { UzumError, UzumErrorCode, uzumErrorFor } from './uzum.errors';

/** Uzum transaction states stored in `payment_transactions.state`. */
export const UzumState = {
  CREATED: 1,
  CONFIRMED: 2,
  REVERSED: -1,
  REVERSED_AFTER_CONFIRM: -2,
} as const;

/** Uzum `status` values. */
export const UzumStatus = {
  OK: 'OK',
  CREATED: 'CREATED',
  CONFIRMED: 'CONFIRMED',
  REVERSED: 'REVERSED',
  FAILED: 'FAILED',
} as const;

export type UzumOperation = 'check' | 'create' | 'confirm' | 'reverse' | 'status';

export interface UzumSettings {
  serviceId: string;
  login: string;
  password: string;
  /** Key of the account value in `params` (set in the Uzum merchant cabinet). */
  accountField: string;
  /** Optional pay link template: {account}, {amount} (tiyin), {sum}. Empty = pay by account in the Uzum app. */
  payUrl: string;
  allowedIps: string[];
}

export function readUzumSettings(config: ConfigService): UzumSettings {
  return {
    serviceId: (config.get<string>('UZUM_SERVICE_ID') ?? '').trim(),
    login: config.get<string>('UZUM_LOGIN') ?? '',
    password: config.get<string>('UZUM_PASSWORD') ?? '',
    accountField: (config.get<string>('UZUM_ACCOUNT_FIELD') || 'account').trim(),
    payUrl: (config.get<string>('UZUM_PAY_URL') ?? '').trim(),
    allowedIps: envList(config.get<string>('UZUM_ALLOWED_IPS')),
  };
}

/** HTTP status and body of one webhook answer (200 on success, 400 with `errorCode` otherwise). */
export interface UzumReply {
  httpStatus: 200 | 400;
  body: Record<string, unknown>;
}

type Body = Record<string, unknown>;

function isRecord(value: unknown): value is Body {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string or a finite number as text (ids and service ids come either way), else null. */
function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

const ms = (date: Date | null): number | null => (date ? date.getTime() : null);

/**
 * Uzum Bank Merchant API webhooks (`POST /api/payments/uzum/<operation>`):
 * `check` (can this account be paid), `create` (a pending transaction),
 * `confirm` (paid), `reverse` (cancelled, also after confirm) and `status`.
 * Basic auth `UZUM_LOGIN:UZUM_PASSWORD`, compared in constant time, and
 * `serviceId` must be UZUM_SERVICE_ID. Amounts are tiyin.
 *
 * `params[UZUM_ACCOUNT_FIELD]` is an invoice number from checkout or, in
 * wallet mode, a user account number (`users.account_no`).
 *
 * Idempotent: a repeated create of a pending transaction, a repeated confirm
 * of a confirmed one and a repeated reverse of a reversed one answer the same
 * result again. The state machine runs under a row lock (PaymentsService), so
 * concurrent confirms credit once.
 */
@Injectable()
export class UzumService implements PaymentProviderAdapter, OnModuleInit {
  readonly provider = PaymentProvider.UZUM;
  readonly manualRefund = false;
  readonly refundHint = 'Refund Uzum payments in the Uzum merchant cabinet: Uzum then calls /reverse';
  readonly settings: UzumSettings;
  private readonly logger = new Logger(UzumService.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderRegistry,
    config: ConfigService,
  ) {
    this.settings = readUzumSettings(config);
  }

  onModuleInit(): void {
    this.providers.register(this);
  }

  isConfigured(): boolean {
    return !!this.settings.serviceId && !!this.settings.login && !!this.settings.password;
  }

  cancelState(paid: boolean): number {
    return paid ? UzumState.REVERSED_AFTER_CONFIRM : UzumState.REVERSED;
  }

  /** UZUM_PAY_URL with {account}, {amount} (tiyin) and {sum} filled in; empty when not set. */
  payUrl(invoice: PaymentInvoice): string {
    return this.settings.payUrl
      .replace(/\{account\}/g, encodeURIComponent(invoice.number))
      .replace(/\{amount\}/g, String(invoice.amount))
      .replace(/\{sum\}/g, (invoice.amount / 100).toFixed(2));
  }

  /** One webhook call → one answer. */
  async handle(operation: UzumOperation, body: unknown, authorization: string | undefined, ip: string): Promise<UzumReply> {
    const request: Body = isRecord(body) ? body : {};
    const transId = this.rawTransId(request);
    try {
      if (!this.authorized(authorization, ip)) throw new UzumError(UzumErrorCode.ACCESS_DENIED, 'Access denied');
      if (!isRecord(body)) throw new UzumError(UzumErrorCode.JSON_PARSING_ERROR, 'The body is not a JSON object');
      if (request.serviceId === undefined || request.serviceId === null) throw new UzumError(UzumErrorCode.MISSING_PARAMS, 'serviceId');
      if (scalarText(request.serviceId) !== this.settings.serviceId) throw new UzumError(UzumErrorCode.INVALID_SERVICE_ID, 'Unknown serviceId');
      const result = await this.dispatch(operation, request);
      return { httpStatus: 200, body: { serviceId: this.serviceIdValue(), timestamp: Date.now(), ...result } };
    } catch (error) {
      let uzum: UzumError;
      if (error instanceof UzumError) uzum = error;
      else if (error instanceof PaymentError) uzum = uzumErrorFor(error.code, error.message);
      else {
        this.logger.error(`Uzum ${operation}: ${(error as Error)?.message}`, (error as Error)?.stack);
        uzum = new UzumError(UzumErrorCode.DATA_CHECK_ERROR, 'Internal error');
      }
      return {
        httpStatus: 400,
        body: {
          serviceId: this.serviceIdValue(),
          timestamp: Date.now(),
          ...(transId ? { transId } : {}),
          status: UzumStatus.FAILED,
          errorCode: uzum.code,
        },
      };
    }
  }

  private dispatch(operation: UzumOperation, request: Body): Promise<Record<string, unknown>> {
    switch (operation) {
      case 'check':
        return this.check(request);
      case 'create':
        return this.create(request);
      case 'confirm':
        return this.confirm(request);
      case 'reverse':
        return this.reverse(request);
      case 'status':
        return this.status(request);
      default:
        throw new UzumError(UzumErrorCode.INVALID_OPERATION, 'Unknown operation');
    }
  }

  // ── Operations ─────────────────────────────────────────────────────────

  /** Can the account be paid at all (no amount yet): an unknown, paid or expired one is refused. */
  private async check(request: Body) {
    const account = this.accountOf(request);
    try {
      await this.payments.resolvePayable(account, this.payments.settings.minAmount);
    } catch (error) {
      // The amount is checked by `create`; here only the account matters.
      if (!(error instanceof PaymentError && error.code === 'wrong_amount')) throw error;
    }
    return { status: UzumStatus.OK, data: this.accountData(account) };
  }

  private async create(request: Body) {
    const transId = this.transIdOf(request);
    const amount = this.amountOf(request);
    const account = this.accountOf(request);

    const existing = await this.payments.findByExternalId(this.provider, transId);
    if (existing) return this.createdResult(this.assertSameCreate(existing, amount, account));

    const payable = await this.payments.resolvePayable(account, amount);
    const timestamp = typeof request.timestamp === 'number' && Number.isFinite(request.timestamp) ? request.timestamp : null;
    const tx = await this.payments.createPending({
      provider: this.provider,
      externalId: transId,
      amount,
      state: UzumState.CREATED,
      payable,
      providerTime: timestamp ? new Date(timestamp) : new Date(),
      raw: { create: { timestamp, params: request.params, at: new Date().toISOString() } },
    });
    // A concurrent create with the same transId may have stored it first.
    return this.createdResult(this.assertSameCreate(tx, amount, account));
  }

  private async confirm(request: Body) {
    const tx = await this.find(request);
    if (tx.status === PaymentStatus.PAID) return this.confirmedResult(tx);
    if (tx.status !== PaymentStatus.PENDING) throw new UzumError(UzumErrorCode.CANCELLED, 'The transaction is reversed');
    const keep = ['paymentSource', 'tariff', 'processingReferenceNumber'];
    const done = await this.payments.transition(tx.id, PaymentStatus.PAID, {
      state: UzumState.CONFIRMED,
      onlyFrom: [PaymentStatus.PENDING],
      raw: {
        confirm: {
          ...Object.fromEntries(keep.filter((k) => request[k] !== undefined).map((k) => [k, request[k]])),
          timestamp: request.timestamp,
          at: new Date().toISOString(),
        },
      },
    });
    return this.confirmedResult(done);
  }

  private async reverse(request: Body) {
    const tx = await this.find(request);
    if (tx.status === PaymentStatus.CANCELLED) return this.reversedResult(tx);
    if (tx.status === PaymentStatus.FAILED) throw new UzumError(UzumErrorCode.CANCELLED, 'The transaction failed');
    const done = await this.payments.transition(tx.id, PaymentStatus.CANCELLED, {
      state: (from) => this.cancelState(from === PaymentStatus.PAID),
      raw: { reverse: { timestamp: request.timestamp, at: new Date().toISOString() } },
    });
    return this.reversedResult(done);
  }

  private async status(request: Body) {
    const tx = await this.find(request);
    return {
      transId: tx.externalId,
      status: this.statusOf(tx),
      transTime: ms(tx.createdAt),
      confirmTime: ms(tx.performedAt),
      reverseTime: tx.status === PaymentStatus.CANCELLED ? ms(tx.cancelledAt) : null,
      data: this.accountData(tx.account ?? ''),
      amount: tx.amount,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private createdResult(tx: PaymentTransaction) {
    return {
      transId: tx.externalId,
      status: UzumStatus.CREATED,
      transTime: ms(tx.createdAt),
      data: this.accountData(tx.account ?? ''),
      amount: tx.amount,
    };
  }

  private confirmedResult(tx: PaymentTransaction) {
    return { transId: tx.externalId, status: UzumStatus.CONFIRMED, confirmTime: ms(tx.performedAt), amount: tx.amount };
  }

  private reversedResult(tx: PaymentTransaction) {
    return { transId: tx.externalId, status: UzumStatus.REVERSED, reverseTime: ms(tx.cancelledAt), amount: tx.amount };
  }

  private statusOf(tx: PaymentTransaction): string {
    switch (tx.status) {
      case PaymentStatus.PENDING:
        return UzumStatus.CREATED;
      case PaymentStatus.PAID:
        return UzumStatus.CONFIRMED;
      case PaymentStatus.CANCELLED:
        return UzumStatus.REVERSED;
      default:
        return UzumStatus.FAILED;
    }
  }

  /** A repeated create answers again only for the same, still pending transaction. */
  private assertSameCreate(tx: PaymentTransaction, amount: number, account: string): PaymentTransaction {
    if (tx.amount !== amount || tx.account !== account) throw new UzumError(UzumErrorCode.DATA_CHECK_ERROR, 'transId is used by another payment');
    if (tx.status === PaymentStatus.PAID) throw new UzumError(UzumErrorCode.ALREADY_PAID, 'The transaction is confirmed');
    if (tx.status !== PaymentStatus.PENDING) throw new UzumError(UzumErrorCode.CANCELLED, 'The transaction is reversed');
    return tx;
  }

  private accountData(account: string) {
    return { [this.settings.accountField]: { value: account } };
  }

  private async find(request: Body): Promise<PaymentTransaction> {
    const tx = await this.payments.findByExternalId(this.provider, this.transIdOf(request));
    if (!tx) throw new UzumError(UzumErrorCode.NOT_FOUND, 'Transaction not found');
    return tx;
  }

  /** `transId` (the documented name; `trans_id` is accepted too). */
  private rawTransId(request: Body): string | null {
    const value = request.transId ?? request.trans_id;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    return null;
  }

  private transIdOf(request: Body): string {
    const id = this.rawTransId(request);
    if (!id || id.length > 64) throw new UzumError(UzumErrorCode.MISSING_PARAMS, 'transId');
    return id;
  }

  /** `amount` in tiyin: a positive safe integer. */
  private amountOf(request: Body): number {
    const amount = request.amount;
    if (amount === undefined || amount === null) throw new UzumError(UzumErrorCode.MISSING_PARAMS, 'amount');
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new UzumError(UzumErrorCode.DATA_CHECK_ERROR, 'Invalid amount');
    }
    return amount;
  }

  private accountOf(request: Body): string {
    const params = isRecord(request.params) ? request.params : {};
    const value = params[this.settings.accountField];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    throw new UzumError(UzumErrorCode.MISSING_PARAMS, this.settings.accountField);
  }

  private serviceIdValue(): number | string {
    return /^\d{1,15}$/.test(this.settings.serviceId) ? Number(this.settings.serviceId) : this.settings.serviceId;
  }

  /** Basic `UZUM_LOGIN:UZUM_PASSWORD` from an allowed IP. Unconfigured = every request is refused. */
  private authorized(header: string | undefined, ip: string): boolean {
    if (!this.isConfigured() || !ipAllowed(this.settings.allowedIps, ip)) return false;
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
