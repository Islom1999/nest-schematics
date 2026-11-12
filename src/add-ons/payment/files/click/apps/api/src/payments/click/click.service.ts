import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PaymentInvoice, PaymentProvider, PaymentStatus, PaymentTransaction } from '@app/database';
import { PaymentProviderAdapter, PaymentProviderRegistry } from '../payment-provider';
import { PaymentError } from '../payment-state';
import { envList } from '../payment.settings';
import { PaymentsService } from '../payments.service';
import { ipAllowed, safeEqual } from '../webhook-security';
import { CLICK_ERROR_NOTES, ClickError, ClickErrorCode, clickErrorFor } from './click.errors';

/** Click transaction states stored in `payment_transactions.state`. */
export const ClickState = {
  PREPARED: 0,
  COMPLETED: 1,
  CANCELLED: -1,
} as const;

export const ClickAction = { PREPARE: 0, COMPLETE: 1 } as const;

export interface ClickSettings {
  serviceId: string;
  merchantId: string;
  merchantUserId: string;
  secretKey: string;
  payUrl: string;
  allowedIps: string[];
}

export function readClickSettings(config: ConfigService): ClickSettings {
  return {
    serviceId: (config.get<string>('CLICK_SERVICE_ID') ?? '').trim(),
    merchantId: (config.get<string>('CLICK_MERCHANT_ID') ?? '').trim(),
    merchantUserId: (config.get<string>('CLICK_MERCHANT_USER_ID') ?? '').trim(),
    secretKey: config.get<string>('CLICK_SECRET_KEY') ?? '',
    payUrl: config.get<string>('CLICK_PAY_URL') || 'https://my.click.uz/services/pay',
    allowedIps: envList(config.get<string>('CLICK_ALLOWED_IPS')),
  };
}

/** Form fields of a Click prepare / complete request (all strings when form-urlencoded). */
export type ClickRequest = Record<string, unknown>;

export interface ClickResponse {
  click_trans_id: string | null;
  merchant_trans_id: string | null;
  merchant_prepare_id?: number | null;
  merchant_confirm_id?: number | null;
  error: number;
  error_note: string;
}

const REQUIRED = ['click_trans_id', 'service_id', 'merchant_trans_id', 'amount', 'action', 'sign_time', 'sign_string'] as const;

function field(body: ClickRequest, name: string): string | null {
  const value = body[name];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** `md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + [merchant_prepare_id] + amount + action + sign_time)` */
export function clickSign(body: ClickRequest, secretKey: string, complete: boolean): string {
  const parts = [
    field(body, 'click_trans_id'),
    field(body, 'service_id'),
    secretKey,
    field(body, 'merchant_trans_id'),
    complete ? field(body, 'merchant_prepare_id') : '',
    field(body, 'amount'),
    field(body, 'action'),
    field(body, 'sign_time'),
  ];
  return createHash('md5')
    .update(parts.map((p) => p ?? '').join(''))
    .digest('hex');
}

/**
 * Click SHOP API (`POST /api/payments/click/prepare` and `/complete`,
 * application/x-www-form-urlencoded). Requests are signed with MD5 over the
 * fields and CLICK_SECRET_KEY, checked in constant time. `merchant_trans_id`
 * (the pay URL's `transaction_param`) is an invoice number from checkout or,
 * in wallet mode, a user account number. Click sends `amount` in sum; it is
 * stored in tiyin. `merchant_prepare_id` / `merchant_confirm_id` are the
 * payment's `number`.
 *
 * Idempotent: a repeated prepare of a pending payment answers the same
 * prepare id; a repeated complete of a paid one answers -4 (Already paid),
 * as the Click docs specify. Click has no refund webhook: refund in the Click
 * cabinet, then cancel the payment in admin/payments (`refundedExternally`).
 */
@Injectable()
export class ClickService implements PaymentProviderAdapter, OnModuleInit {
  readonly provider = PaymentProvider.CLICK;
  readonly manualRefund = true;
  readonly refundHint = 'Refund Click payments in the Click merchant cabinet, then cancel them here with refundedExternally: true';
  readonly settings: ClickSettings;
  private readonly logger = new Logger(ClickService.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderRegistry,
    config: ConfigService,
  ) {
    this.settings = readClickSettings(config);
  }

  onModuleInit(): void {
    this.providers.register(this);
  }

  isConfigured(): boolean {
    return !!this.settings.serviceId && !!this.settings.merchantId && !!this.settings.secretKey;
  }

  cancelState(): number {
    return ClickState.CANCELLED;
  }

  /** `https://my.click.uz/services/pay?service_id=..&merchant_id=..&amount=<sum>&transaction_param=<invoice>&return_url=..` */
  payUrl(invoice: PaymentInvoice): string {
    const query = new URLSearchParams({
      service_id: this.settings.serviceId,
      merchant_id: this.settings.merchantId,
      amount: (invoice.amount / 100).toFixed(2),
      transaction_param: invoice.number,
    });
    const returnUrl = this.payments.settings.returnUrl;
    if (returnUrl) query.set('return_url', returnUrl);
    if (this.settings.merchantUserId) query.set('merchant_user_id', this.settings.merchantUserId);
    return `${this.settings.payUrl}?${query.toString()}`;
  }

  prepare(body: ClickRequest, ip: string): Promise<ClickResponse> {
    return this.run(body, ip, false, async () => {
      const externalId = field(body, 'click_trans_id')!;
      const amount = this.tiyin(body);
      const existing = await this.payments.findByExternalId(this.provider, externalId);
      if (existing) {
        this.assertOpen(existing);
        if (existing.amount !== amount) throw new ClickError(ClickErrorCode.INCORRECT_AMOUNT);
        return { merchant_prepare_id: Number(existing.number) };
      }
      const payable = await this.payments.resolvePayable(field(body, 'merchant_trans_id')!, amount);
      const tx = await this.payments.createPending({
        provider: this.provider,
        externalId,
        amount,
        state: ClickState.PREPARED,
        payable,
        providerTime: new Date(),
        raw: { prepare: this.snapshot(body) },
      });
      this.assertOpen(tx);
      return { merchant_prepare_id: Number(tx.number) };
    });
  }

  complete(body: ClickRequest, ip: string): Promise<ClickResponse> {
    return this.run(body, ip, true, async () => {
      const tx = await this.payments.findByExternalId(this.provider, field(body, 'click_trans_id')!);
      if (!tx || tx.number !== field(body, 'merchant_prepare_id')) throw new ClickError(ClickErrorCode.TRANSACTION_NOT_FOUND);
      if (tx.account !== field(body, 'merchant_trans_id')) throw new ClickError(ClickErrorCode.TRANSACTION_NOT_FOUND);
      if (tx.amount !== this.tiyin(body)) throw new ClickError(ClickErrorCode.INCORRECT_AMOUNT);
      this.assertOpen(tx);

      const clickError = Number(field(body, 'error') ?? 0);
      if (Number.isFinite(clickError) && clickError < 0) {
        // Click reports that the payment failed on its side.
        await this.payments.transition(tx.id, PaymentStatus.FAILED, {
          state: ClickState.CANCELLED,
          reason: clickError,
          onlyFrom: [PaymentStatus.PENDING],
          raw: { complete: this.snapshot(body) },
        });
        throw new ClickError(ClickErrorCode.TRANSACTION_CANCELLED);
      }

      const done = await this.payments.transition(tx.id, PaymentStatus.PAID, {
        state: ClickState.COMPLETED,
        onlyFrom: [PaymentStatus.PENDING],
        raw: { complete: this.snapshot(body) },
      });
      return { merchant_confirm_id: Number(done.number) };
    });
  }

  private async run(
    body: ClickRequest,
    ip: string,
    complete: boolean,
    action: () => Promise<Partial<ClickResponse>>,
  ): Promise<ClickResponse> {
    const base = { click_trans_id: field(body, 'click_trans_id'), merchant_trans_id: field(body, 'merchant_trans_id') };
    const idKey = complete ? 'merchant_confirm_id' : 'merchant_prepare_id';
    try {
      this.verify(body, ip, complete);
      const result = await action();
      return { ...base, [idKey]: null, ...result, error: ClickErrorCode.SUCCESS, error_note: CLICK_ERROR_NOTES[ClickErrorCode.SUCCESS] };
    } catch (error) {
      let click: ClickError;
      if (error instanceof ClickError) click = error;
      else if (error instanceof PaymentError) click = clickErrorFor(error.code);
      else {
        this.logger.error(`Click ${complete ? 'complete' : 'prepare'}: ${(error as Error)?.message}`, (error as Error)?.stack);
        click = new ClickError(ClickErrorCode.FAILED_TO_UPDATE);
      }
      return { ...base, [idKey]: null, error: click.code, error_note: click.message };
    }
  }

  /** IP allowlist, required fields, the MD5 sign, the service id and the action. */
  private verify(body: ClickRequest, ip: string, complete: boolean): void {
    if (!this.isConfigured() || !ipAllowed(this.settings.allowedIps, ip)) throw new ClickError(ClickErrorCode.SIGN_CHECK_FAILED);
    const required: readonly string[] = complete ? [...REQUIRED, 'merchant_prepare_id'] : REQUIRED;
    if (required.some((name) => !field(body, name))) throw new ClickError(ClickErrorCode.BAD_REQUEST);
    if (!safeEqual(field(body, 'sign_string')!.toLowerCase(), clickSign(body, this.settings.secretKey, complete))) {
      throw new ClickError(ClickErrorCode.SIGN_CHECK_FAILED);
    }
    if (field(body, 'service_id') !== this.settings.serviceId) throw new ClickError(ClickErrorCode.BAD_REQUEST);
    const action = Number(field(body, 'action'));
    if (action !== (complete ? ClickAction.COMPLETE : ClickAction.PREPARE)) throw new ClickError(ClickErrorCode.ACTION_NOT_FOUND);
  }

  /** Click `amount` (sum, up to 2 decimals) → tiyin. */
  private tiyin(body: ClickRequest): number {
    const raw = field(body, 'amount') ?? '';
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new ClickError(ClickErrorCode.INCORRECT_AMOUNT);
    const amount = Math.round(Number(raw) * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new ClickError(ClickErrorCode.INCORRECT_AMOUNT);
    return amount;
  }

  private assertOpen(tx: PaymentTransaction): void {
    if (tx.status === PaymentStatus.PAID) throw new ClickError(ClickErrorCode.ALREADY_PAID);
    if (tx.status !== PaymentStatus.PENDING) throw new ClickError(ClickErrorCode.TRANSACTION_CANCELLED);
  }

  private snapshot(body: ClickRequest): Record<string, unknown> {
    const keep = ['click_trans_id', 'click_paydoc_id', 'merchant_trans_id', 'merchant_prepare_id', 'amount', 'action', 'error', 'error_note', 'sign_time'];
    return { ...Object.fromEntries(keep.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])), at: new Date().toISOString() };
  }
}
