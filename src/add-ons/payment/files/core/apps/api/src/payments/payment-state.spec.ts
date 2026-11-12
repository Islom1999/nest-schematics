import { PaymentStatus, PaymentTransaction } from '@app/database';
import { applyTransition, canTransition, PaymentError } from './payment-state';
import { ipAllowed, safeEqual } from './webhook-security';

const tx = (status: PaymentStatus) => Object.assign(new PaymentTransaction(), { status, state: 1, reason: null, raw: { create: { rpcId: 1 } } });

describe('payment state machine', () => {
  it('allows pending → paid | cancelled | failed and paid → cancelled only', () => {
    expect(canTransition(PaymentStatus.PENDING, PaymentStatus.PAID)).toBe(true);
    expect(canTransition(PaymentStatus.PENDING, PaymentStatus.FAILED)).toBe(true);
    expect(canTransition(PaymentStatus.PAID, PaymentStatus.CANCELLED)).toBe(true);
    expect(canTransition(PaymentStatus.PAID, PaymentStatus.FAILED)).toBe(false);
    expect(canTransition(PaymentStatus.CANCELLED, PaymentStatus.PAID)).toBe(false);
    expect(canTransition(PaymentStatus.FAILED, PaymentStatus.PAID)).toBe(false);
  });

  it('applies a transition with the provider state, reason, raw and timestamps', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const paid = tx(PaymentStatus.PENDING);
    expect(applyTransition(paid, PaymentStatus.PAID, { state: 2, raw: { perform: { rpcId: 2 } } }, now)).toBe(true);
    expect(paid).toEqual(expect.objectContaining({ status: 'paid', state: 2, performedAt: now }));
    expect(paid.raw).toEqual({ create: { rpcId: 1 }, perform: { rpcId: 2 } });

    expect(applyTransition(paid, PaymentStatus.CANCELLED, { state: (from) => (from === PaymentStatus.PAID ? -2 : -1), reason: 5 }, now)).toBe(true);
    expect(paid).toEqual(expect.objectContaining({ status: 'cancelled', state: -2, reason: 5, cancelledAt: now }));
  });

  it('is a no-op for the current status and refuses forbidden moves', () => {
    const paid = tx(PaymentStatus.PAID);
    expect(applyTransition(paid, PaymentStatus.PAID, { state: 99 })).toBe(false);
    expect(paid.state).toBe(1);
    expect(() => applyTransition(tx(PaymentStatus.CANCELLED), PaymentStatus.PAID)).toThrow(PaymentError);
    let error: unknown;
    try {
      applyTransition(tx(PaymentStatus.PAID), PaymentStatus.CANCELLED, { onlyFrom: [PaymentStatus.PENDING] });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PaymentError);
    expect((error as PaymentError).code).toBe('invalid_state');
  });
});

describe('webhook security', () => {
  it('compares secrets in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('checks IP allowlists (empty = everyone, exact or IPv4 CIDR)', () => {
    expect(ipAllowed([], '1.2.3.4')).toBe(true);
    expect(ipAllowed(['1.2.3.4'], '::ffff:1.2.3.4')).toBe(true);
    expect(ipAllowed(['10.0.0.0/8'], '10.200.3.4')).toBe(true);
    expect(ipAllowed(['10.0.0.0/8'], '11.0.0.1')).toBe(false);
    expect(ipAllowed(['10.0.0.0/8'], '::1')).toBe(false);
  });
});
