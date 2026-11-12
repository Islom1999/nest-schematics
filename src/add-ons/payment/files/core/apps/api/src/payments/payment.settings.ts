import { ConfigService } from '@nestjs/config';

export interface PaymentSettings {
  /** Smallest top-up / direct payment, tiyin. */
  minAmount: number;
  /** Largest top-up / direct payment, tiyin. */
  maxAmount: number;
  /** Minutes an invoice accepts new provider transactions. */
  invoiceTtlMinutes: number;
  /** Where the provider's pay page sends the user back (empty = provider default). */
  returnUrl: string;
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export function readPaymentSettings(config: ConfigService): PaymentSettings {
  return {
    minAmount: positiveInt(config.get('PAYMENT_MIN_AMOUNT'), 100_000),
    maxAmount: positiveInt(config.get('PAYMENT_MAX_AMOUNT'), 1_000_000_000),
    invoiceTtlMinutes: positiveInt(config.get('PAYMENT_INVOICE_TTL_MINUTES'), 1440),
    returnUrl: (config.get<string>('PAYMENT_RETURN_URL') ?? '').trim(),
  };
}

/** `a,b , c` → `['a', 'b', 'c']`. */
export function envList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function envFlag(value: string | undefined): boolean {
  return ['true', '1'].includes((value ?? '').trim().toLowerCase());
}
