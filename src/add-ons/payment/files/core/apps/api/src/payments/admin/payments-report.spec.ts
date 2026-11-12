import { PaymentPurpose, PaymentStatus, PaymentTransaction } from '@app/database';
import { csvCell, csvLine, PAYMENT_CSV_COLUMNS, paymentCsvRow, summarizePayments } from './payments-report';

describe('payments summary', () => {
  it('rolls (status, provider) groups up by status and provider; revenue is paid only', () => {
    const summary = summarizePayments(
      [
        { status: 'paid', provider: 'click', count: '2', amount: '700000' },
        { status: 'paid', provider: 'payme', count: '1', amount: '500000' },
        { status: 'cancelled', provider: 'payme', count: '1', amount: '500000' },
        { status: 'pending', provider: 'click', count: '3', amount: '9900' },
      ],
      { from: '2026-01-01T00:00:00Z', to: null, provider: null },
    );
    expect(summary).toEqual(
      expect.objectContaining({ from: '2026-01-01T00:00:00Z', to: null, provider: null, revenue: 1200000, paidCount: 3, count: 7 }),
    );
    expect(summary.byStatus).toEqual([
      { status: PaymentStatus.PENDING, count: 3, amount: 9900 },
      { status: PaymentStatus.PAID, count: 3, amount: 1200000 },
      { status: PaymentStatus.CANCELLED, count: 1, amount: 500000 },
      { status: PaymentStatus.FAILED, count: 0, amount: 0 },
    ]);
    expect(summary.byProvider).toEqual([
      { provider: 'click', count: 5, amount: 709900, paidCount: 2, paidAmount: 700000 },
      { provider: 'payme', count: 2, amount: 1000000, paidCount: 1, paidAmount: 500000 },
    ]);
  });

  it('is all zeros without payments', () => {
    const summary = summarizePayments([], { from: null, to: null, provider: 'payme' });
    expect(summary.revenue).toBe(0);
    expect(summary.byStatus.every((s) => s.count === 0)).toBe(true);
    expect(summary.byProvider).toEqual([]);
  });
});

describe('payments CSV', () => {
  it('prefixes cells that a spreadsheet would run as a formula', () => {
    for (const formula of ['=HYPERLINK("http://x")', '+1+2', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
      expect(csvCell(formula).replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('safe')).toBe('safe');
  });

  it('keeps our numbers as numbers (negative provider states)', () => {
    expect(csvCell(-2)).toBe('-2');
    expect(csvCell(500000)).toBe('500000');
  });

  it('quotes commas, quotes and line breaks; empty for null', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=a,b')).toBe(`"'=a,b"`);
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvLine(['x', null, 1])).toBe('x,,1\r\n');
  });

  it('writes one row per payment in column order, dates as ISO', () => {
    const tx = Object.assign(new PaymentTransaction(), {
      number: '7',
      id: 'p1',
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
      provider: 'payme',
      externalId: '=cmd',
      status: PaymentStatus.PAID,
      state: 2,
      purpose: PaymentPurpose.TOPUP,
      amount: 500000,
      account: '1000000001',
    });
    const cells = paymentCsvRow(tx).trimEnd().split(',');
    expect(cells).toHaveLength(PAYMENT_CSV_COLUMNS.length);
    expect(cells.slice(0, 9)).toEqual(['7', 'p1', '2026-01-02T03:04:05.000Z', 'payme', "'=cmd", 'paid', '2', 'topup', '500000']);
  });
});
