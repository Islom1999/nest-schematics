import { PaymentErrorCode } from '../payment-state';

/** Click SHOP API `error` codes (docs.click.uz → "Merchant API" / SHOP API). */
export const ClickErrorCode = {
  SUCCESS: 0,
  SIGN_CHECK_FAILED: -1,
  INCORRECT_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  USER_NOT_FOUND: -5,
  TRANSACTION_NOT_FOUND: -6,
  FAILED_TO_UPDATE: -7,
  BAD_REQUEST: -8,
  TRANSACTION_CANCELLED: -9,
} as const;

export const CLICK_ERROR_NOTES: Record<number, string> = {
  [ClickErrorCode.SUCCESS]: 'Success',
  [ClickErrorCode.SIGN_CHECK_FAILED]: 'SIGN CHECK FAILED!',
  [ClickErrorCode.INCORRECT_AMOUNT]: 'Incorrect parameter amount',
  [ClickErrorCode.ACTION_NOT_FOUND]: 'Action not found',
  [ClickErrorCode.ALREADY_PAID]: 'Already paid',
  [ClickErrorCode.USER_NOT_FOUND]: 'User does not exist',
  [ClickErrorCode.TRANSACTION_NOT_FOUND]: 'Transaction does not exist',
  [ClickErrorCode.FAILED_TO_UPDATE]: 'Failed to update user',
  [ClickErrorCode.BAD_REQUEST]: 'Error in request from click',
  [ClickErrorCode.TRANSACTION_CANCELLED]: 'Transaction cancelled',
};

export class ClickError extends Error {
  constructor(readonly code: number) {
    super(CLICK_ERROR_NOTES[code] ?? 'Error');
    this.name = 'ClickError';
  }
}

/** Core payment errors → Click codes. */
export function clickErrorFor(code: PaymentErrorCode): ClickError {
  switch (code) {
    case 'account_not_found':
      return new ClickError(ClickErrorCode.USER_NOT_FOUND);
    case 'wrong_amount':
      return new ClickError(ClickErrorCode.INCORRECT_AMOUNT);
    case 'already_paid':
      return new ClickError(ClickErrorCode.ALREADY_PAID);
    case 'transaction_not_found':
      return new ClickError(ClickErrorCode.TRANSACTION_NOT_FOUND);
    case 'not_payable':
    case 'invalid_state':
      return new ClickError(ClickErrorCode.TRANSACTION_CANCELLED);
    case 'busy':
    case 'cancel_refused':
      return new ClickError(ClickErrorCode.FAILED_TO_UPDATE);
  }
}
