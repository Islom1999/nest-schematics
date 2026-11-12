import { PaymentStatus, PaymentTransaction } from '@app/database';

/**
 * The provider-independent state machine of a payment transaction:
 *
 *   pending ──► paid ──► cancelled   (refund / provider cancel after perform)
 *      │
 *      ├──────► cancelled            (cancelled before it was paid, timeout)
 *      └──────► failed               (the provider reported an error)
 *
 * `cancelled` and `failed` are final. Moving to the status a transaction
 * already has is a no-op, so repeated provider callbacks are harmless.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.PAID, PaymentStatus.CANCELLED, PaymentStatus.FAILED],
  [PaymentStatus.PAID]: [PaymentStatus.CANCELLED],
  [PaymentStatus.CANCELLED]: [],
  [PaymentStatus.FAILED]: [],
};

/**
 * Why a payment cannot go on. Providers map these to their own error codes
 * (Payme -31050..., Click -5...).
 */
export type PaymentErrorCode =
  /** Unknown invoice or account, or top-ups are not enabled. */
  | 'account_not_found'
  /** The invoice is paid already. */
  | 'already_paid'
  /** The invoice is cancelled or expired, or its target is not payable any more. */
  | 'not_payable'
  /** Another transaction of the same provider is waiting for this invoice. */
  | 'busy'
  | 'wrong_amount'
  | 'transaction_not_found'
  /** The transition is not allowed from the current status. */
  | 'invalid_state'
  /** A paid payment cannot be reversed (top-up already spent, order delivered). */
  | 'cancel_refused';

export class PaymentError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** Fields a provider sets with a transition. */
export interface TransitionPatch {
  /** Provider state code after the transition, or a function of the status before it. */
  state?: number | ((from: PaymentStatus) => number);
  /** Statuses the transition may start from (default: any the state machine allows). */
  onlyFrom?: readonly PaymentStatus[];
  /** Provider cancel reason / error code. */
  reason?: number | null;
  /** Merged into `raw` (e.g. `{ perform: { rpcId, at } }`). */
  raw?: Record<string, unknown>;
}

/**
 * Applies a transition to the entity in memory (no I/O). Returns false when
 * the transaction already has `to` (nothing to do); throws `invalid_state`
 * when the move is not allowed.
 */
export function applyTransition(tx: PaymentTransaction, to: PaymentStatus, patch: TransitionPatch = {}, now = new Date()): boolean {
  const from = tx.status;
  if (from === to) return false;
  if (!canTransition(from, to) || (patch.onlyFrom && !patch.onlyFrom.includes(from))) {
    throw new PaymentError('invalid_state', `A ${from} payment cannot become ${to}`);
  }
  tx.status = to;
  if (patch.state !== undefined) tx.state = typeof patch.state === 'function' ? patch.state(from) : patch.state;
  if (patch.reason !== undefined) tx.reason = patch.reason;
  if (patch.raw) tx.raw = { ...(tx.raw ?? {}), ...patch.raw };
  if (to === PaymentStatus.PAID) tx.performedAt = now;
  if (to === PaymentStatus.CANCELLED || to === PaymentStatus.FAILED) tx.cancelledAt = now;
  return true;
}
