import { ValueTransformer } from 'typeorm';

/**
 * Installed payment providers. `npm run g -- payment <provider>` adds one
 * above the marker (and its webhook controller in apps/api/src/payments).
 */
export enum PaymentProvider {
  // @ns:payment-providers
}

/** Provider-independent status of a payment transaction (the provider's own code is `state`). */
export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

/** What a payment is for: a wallet top-up or a registered PaymentTarget (an order...). */
export enum PaymentPurpose {
  TOPUP = 'topup',
  ORDER = 'order',
}

export enum PaymentInvoiceStatus {
  PENDING = 'pending',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

/**
 * Money is stored as bigint tiyin (1 sum = 100 tiyin). Postgres returns
 * bigint as a string; amounts stay far below Number.MAX_SAFE_INTEGER.
 */
export const tiyinTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? value : Number(value)),
};
