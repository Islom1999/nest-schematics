import { PaymentStatus, PaymentTransaction } from '@app/database';
import type { PaymentProviderTotalsDto, PaymentSummaryDto } from './admin-payments.dto';

/** One row of the summary query: `GROUP BY status, provider` (count and sum come back as strings). */
export interface PaymentSummaryRow {
  status: string;
  provider: string;
  count: string | number;
  amount: string | number;
}

/**
 * Rolls the `(status, provider)` groups up into totals by status (every
 * status, zeros included) and by provider. Integer tiyin throughout.
 */
export function summarizePayments(
  rows: PaymentSummaryRow[],
  period: Pick<PaymentSummaryDto, 'from' | 'to' | 'provider'>,
): PaymentSummaryDto {
  const byStatus = new Map(Object.values(PaymentStatus).map((status) => [status as string, { status, count: 0, amount: 0 }]));
  const byProvider = new Map<string, PaymentProviderTotalsDto>();
  let count = 0;
  for (const row of rows) {
    const n = toInteger(row.count);
    const amount = toInteger(row.amount);
    count += n;
    const status = byStatus.get(row.status);
    if (status) {
      status.count += n;
      status.amount += amount;
    }
    const provider = byProvider.get(row.provider) ?? { provider: row.provider, count: 0, amount: 0, paidCount: 0, paidAmount: 0 };
    provider.count += n;
    provider.amount += amount;
    if (row.status === (PaymentStatus.PAID as string)) {
      provider.paidCount += n;
      provider.paidAmount += amount;
    }
    byProvider.set(row.provider, provider);
  }
  const paid = byStatus.get(PaymentStatus.PAID)!;
  return {
    ...period,
    revenue: paid.amount,
    paidCount: paid.count,
    count,
    byStatus: [...byStatus.values()],
    byProvider: [...byProvider.values()].sort((a, b) => b.paidAmount - a.paidAmount || a.provider.localeCompare(b.provider)),
  };
}

function toInteger(value: string | number): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Payment total out of range: ${value}`);
  return n;
}

/** Columns of `GET admin/payments/export`, in order. `raw` is left out (open the payment for it). */
export const PAYMENT_CSV_COLUMNS = [
  'number',
  'id',
  'createdAt',
  'provider',
  'externalId',
  'status',
  'state',
  'purpose',
  'amount',
  'userId',
  'invoiceId',
  'account',
  'targetType',
  'targetId',
  'providerTime',
  'performedAt',
  'cancelledAt',
  'reason',
] as const satisfies readonly (keyof PaymentTransaction)[];

/** Spreadsheet apps run a cell starting with one of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell (RFC 4180 quoting). Text that starts like a formula
 * (`=`, `+`, `-`, `@`, tab, CR) gets a leading `'` so Excel / LibreOffice /
 * Google Sheets show it as text (CSV injection). Numbers from our own columns
 * (`amount`, `state` -1...) stay numbers.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  // Our columns are text, numbers and dates; anything else (booleans, jsonb) as JSON.
  let text = typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : (JSON.stringify(value) ?? '');
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: readonly unknown[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

export function paymentCsvRow(tx: PaymentTransaction): string {
  return csvLine(PAYMENT_CSV_COLUMNS.map((column) => tx[column]));
}
