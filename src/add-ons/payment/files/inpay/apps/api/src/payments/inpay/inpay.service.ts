import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { CACHE_STORE, CacheStore } from '@app/common';
import { PaymentInvoice, PaymentProvider, PaymentStatus, PaymentTransaction } from '@app/database';
import { PaymentProviderAdapter, PaymentProviderRegistry } from '../payment-provider';
import { PaymentError } from '../payment-state';
import { envList } from '../payment.settings';
import { PaymentsService } from '../payments.service';
import { ipAllowed } from '../webhook-security';

/** States stored in `payment_transactions.state`. */
export const InpayState = {
  PENDING: 0,
  PAID: 1,
  CANCELLED: -1,
  FAILED: -2,
} as const;

/** Order statuses of the inPAY API. */
export type InpayRemoteStatus = 'pending' | 'success' | 'failed' | 'cancelled';
const REMOTE_STATUSES: readonly string[] = ['pending', 'success', 'failed', 'cancelled'];

/** The bearer token lives 24 hours; it is refreshed an hour early. */
export const INPAY_TOKEN_TTL_MS = 23 * 3_600_000;
const REQUEST_TIMEOUT_MS = 15_000;
const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface InpaySettings {
  merchantId: string;
  merchantToken: string;
  /** Base URL of the API, `/authorization/`, `/create/` and `/transactions/` are below it. */
  apiUrl: string;
  /** Webhook URL sent with every order (optional: else the one set in the inPAY cabinet). */
  callbackUrl: string;
  /** Optional `payment_method` (click, payme, ...): empty = the client picks on the inPAY page. */
  paymentMethod: string;
  description: string;
  allowedIps: string[];
}

export function readInpaySettings(config: ConfigService): InpaySettings {
  return {
    merchantId: (config.get<string>('INPAY_MERCHANT_ID') ?? '').trim(),
    merchantToken: config.get<string>('INPAY_MERCHANT_TOKEN') ?? '',
    apiUrl: (config.get<string>('INPAY_API_URL') || 'https://inpay.uz/api/v1').trim().replace(/\/+$/, ''),
    callbackUrl: (config.get<string>('INPAY_CALLBACK_URL') ?? '').trim(),
    paymentMethod: (config.get<string>('INPAY_PAYMENT_METHOD') ?? '').trim(),
    description: (config.get<string>('INPAY_DESCRIPTION') || 'Payment').trim(),
    allowedIps: envList(config.get<string>('INPAY_ALLOWED_IPS')),
  };
}

/** What the inPAY API says about an order (the webhook body is never trusted). */
export interface InpayOrderState {
  orderId: string | null;
  status: InpayRemoteStatus;
  /** Tiyin, or null when the API sent no valid amount. */
  amount: number | null;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** inPAY amounts are sum (up to 2 decimals) → tiyin, or null. */
export function inpayTiyin(value: unknown): number | null {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const tiyin = Math.round(Number(text) * 100);
  return Number.isSafeInteger(tiyin) && tiyin > 0 ? tiyin : null;
}

/**
 * inPAY (https://inpay.uz): an aggregator page (Click, Payme, cards...).
 * Checkout calls `createTopUp`: the API creates an order and answers its pay
 * URL; the order id becomes a pending payment. The bearer token (24 h) is
 * cached in CACHE_STORE (shared with the redis add-on) and refreshed once on
 * a 401; concurrent requests share one authorization call.
 *
 * The webhook (`POST /api/payments/inpay/webhook`) is not signed, so its body
 * is only a hint: the order must be ours and still pending, and its status and
 * amount are fetched again from the inPAY API before anything changes. The
 * transition runs in one DB transaction with a `pessimistic_write` lock on the
 * payment row (PaymentsService), so repeated or concurrent webhooks credit once.
 * Refunds: return the money in the inPAY cabinet, then cancel the payment in
 * admin/payments with `refundedExternally: true`.
 */
@Injectable()
export class InpayService implements PaymentProviderAdapter, OnModuleInit {
  readonly provider = PaymentProvider.INPAY;
  readonly manualRefund = true;
  readonly refundHint = 'Refund inPAY payments in the inPAY cabinet, then cancel them here with refundedExternally: true';
  readonly settings: InpaySettings;
  /** HTTP client (replaced in specs). */
  http: typeof fetch = (input, init) => fetch(input, init);
  private readonly logger = new Logger(InpayService.name);
  private tokenInFlight: Promise<string> | null = null;

  constructor(
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderRegistry,
    config: ConfigService,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
  ) {
    this.settings = readInpaySettings(config);
  }

  onModuleInit(): void {
    this.providers.register(this);
  }

  isConfigured(): boolean {
    return !!this.settings.merchantId && !!this.settings.merchantToken;
  }

  cancelState(): number {
    return InpayState.CANCELLED;
  }

  /** Creates the inPAY order for a checkout invoice and stores it as a pending payment. */
  async payUrl(invoice: PaymentInvoice): Promise<string> {
    const payable = await this.payments.resolvePayable(invoice.number, invoice.amount);
    const order = await this.createTopUp(invoice);
    await this.payments.createPending({
      provider: this.provider,
      externalId: order.orderId,
      amount: invoice.amount,
      state: InpayState.PENDING,
      payable,
      providerTime: new Date(),
      raw: { create: { orderId: order.orderId, at: new Date().toISOString() } },
    });
    return order.payUrl;
  }

  /** `POST /create/`: a new inPAY order for the invoice amount. */
  async createTopUp(invoice: PaymentInvoice): Promise<{ orderId: string; payUrl: string }> {
    if (!this.isConfigured()) throw new ServiceUnavailableException('inpay payments are not configured');
    const body: Json = {
      merchant_id: this.settings.merchantId,
      token: this.settings.merchantToken,
      amount: Number((invoice.amount / 100).toFixed(2)),
      description: `${this.settings.description} #${invoice.number}`,
    };
    if (this.settings.paymentMethod) body.payment_method = this.settings.paymentMethod;
    if (this.settings.callbackUrl) body.callback_url = this.settings.callbackUrl;
    const returnUrl = this.payments.settings.returnUrl;
    if (returnUrl) body.return_url = returnUrl;

    const { status, data } = await this.authorizedRequest('/create/', { method: 'POST', body: JSON.stringify(body) });
    const orderId = typeof data.order_id === 'number' ? String(data.order_id) : data.order_id;
    const payUrl = data.pay_url;
    if (status < 200 || status >= 300 || data.success !== true || typeof orderId !== 'string' || !ORDER_ID.test(orderId) || !this.isHttpUrl(payUrl)) {
      this.logger.error(`inPAY create failed: HTTP ${status} ${typeof data.error_code === 'string' ? data.error_code : ''}`);
      if (data.error_code === 'AMOUNT_TOO_LOW' || data.error_code === 'AMOUNT_TOO_HIGH') {
        throw new BadRequestException('inPAY does not accept this amount');
      }
      throw new BadGatewayException('inPAY could not create the payment');
    }
    return { orderId, payUrl: payUrl as string };
  }

  /** `GET /transactions/?order_id=`: the order as inPAY sees it. */
  async fetchState(orderId: string): Promise<InpayOrderState> {
    const { status, data: raw } = await this.authorizedRequest(`/transactions/?order_id=${encodeURIComponent(orderId)}`, { method: 'GET' });
    // The order is in `data`, or flat in some answers.
    const data = isRecord(raw.data) ? raw.data : raw;
    if (status < 200 || status >= 300 || raw.success !== true || typeof data.status !== 'string' || !REMOTE_STATUSES.includes(data.status)) {
      this.logger.error(`inPAY status of ${orderId} failed: HTTP ${status}`);
      throw new BadGatewayException('inPAY status is not available');
    }
    const remoteId = typeof data.order_id === 'number' ? String(data.order_id) : typeof data.order_id === 'string' ? data.order_id : null;
    return { orderId: remoteId, status: data.status as InpayRemoteStatus, amount: inpayTiyin(data.amount) };
  }

  /**
   * Webhook: `{ order_id, status, amount, ... }`. Unknown or settled orders are
   * acknowledged without changes; a failing inPAY API answers 502 so inPAY
   * retries.
   */
  async handleWebhook(body: unknown, ip: string): Promise<{ success: true }> {
    if (!this.isConfigured()) throw new ServiceUnavailableException('inpay payments are not configured');
    if (!ipAllowed(this.settings.allowedIps, ip)) throw new ForbiddenException();
    const value = isRecord(body) ? body.order_id : undefined;
    const orderId = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
    if (typeof orderId !== 'string' || !ORDER_ID.test(orderId)) throw new BadRequestException('order_id is required');

    const tx = await this.payments.findByExternalId(this.provider, orderId);
    if (!tx) {
      this.logger.warn(`inPAY webhook for an unknown order ${orderId}`);
      return { success: true };
    }
    if (tx.status !== PaymentStatus.PENDING) return { success: true };
    await this.sync(tx, await this.fetchState(orderId));
    return { success: true };
  }

  /** Applies the API state to a pending payment (under the row lock of `transition`). */
  private async sync(tx: PaymentTransaction, remote: InpayOrderState): Promise<void> {
    if (remote.orderId !== null && remote.orderId !== tx.externalId) {
      this.logger.error(`inPAY answered order ${remote.orderId} for ${tx.externalId}: ignored`);
      return;
    }
    const raw = { webhook: { status: remote.status, amount: remote.amount, at: new Date().toISOString() } };
    try {
      switch (remote.status) {
        case 'success':
          if (remote.amount !== tx.amount) {
            // Left pending for a manual check: never credit an amount we did not ask for.
            this.logger.error(`inPAY amount mismatch for ${tx.externalId}: expected ${tx.amount}, inPAY ${remote.amount} (tiyin)`);
            return;
          }
          await this.payments.transition(tx.id, PaymentStatus.PAID, { state: InpayState.PAID, onlyFrom: [PaymentStatus.PENDING], raw });
          return;
        case 'failed':
          await this.payments.transition(tx.id, PaymentStatus.FAILED, { state: InpayState.FAILED, onlyFrom: [PaymentStatus.PENDING], raw });
          return;
        case 'cancelled':
          await this.payments.transition(tx.id, PaymentStatus.CANCELLED, { state: InpayState.CANCELLED, onlyFrom: [PaymentStatus.PENDING], raw });
          return;
        case 'pending':
          return;
      }
    } catch (error) {
      // Settled meanwhile (a concurrent webhook, an admin cancel) or the invoice was paid by another payment.
      if (!(error instanceof PaymentError)) throw error;
      this.logger.warn(`inPAY ${tx.externalId}: ${error.message}`);
    }
  }

  // ── HTTP ───────────────────────────────────────────────────────────────

  private tokenKey(): string {
    return `payment:inpay:token:${createHash('sha256').update(this.settings.merchantId).digest('hex').slice(0, 16)}`;
  }

  /** The cached bearer token, or a new one (`GET /authorization/`). */
  async token(force = false): Promise<string> {
    if (!force) {
      const cached = await this.cache.get<string>(this.tokenKey());
      if (cached) return cached;
    }
    if (this.tokenInFlight) return this.tokenInFlight;
    this.tokenInFlight = (async () => {
      const query = new URLSearchParams({ merchant_id: this.settings.merchantId, merchant_token: this.settings.merchantToken });
      const { status, data } = await this.request(`/authorization/?${query.toString()}`, { method: 'GET' });
      const token = data.bearer_token;
      if (status !== 200 || data.success !== true || typeof token !== 'string' || !token) {
        this.logger.error(`inPAY authorization failed: HTTP ${status}`);
        throw new BadGatewayException('inPAY authorization failed');
      }
      await this.cache.set(this.tokenKey(), token, INPAY_TOKEN_TTL_MS);
      return token;
    })().finally(() => {
      this.tokenInFlight = null;
    });
    return this.tokenInFlight;
  }

  /** A request with the bearer token; a 401 gets a new token once. */
  private async authorizedRequest(path: string, init: RequestInit): Promise<{ status: number; data: Json }> {
    const send = async (token: string) =>
      this.request(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    const first = await send(await this.token());
    if (first.status !== 401) return first;
    await this.cache.delete(this.tokenKey());
    return send(await this.token(true));
  }

  private async request(path: string, init: RequestInit): Promise<{ status: number; data: Json }> {
    let response: Response;
    try {
      response = await this.http(`${this.settings.apiUrl}${path}`, {
        ...init,
        headers: { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`inPAY ${path.split('?')[0]}: ${(error as Error)?.message}`);
      throw new BadGatewayException('inPAY is not reachable');
    }
    const data: unknown = await response.json().catch(() => ({}));
    return { status: response.status, data: isRecord(data) ? data : {} };
  }

  private isHttpUrl(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }
}
