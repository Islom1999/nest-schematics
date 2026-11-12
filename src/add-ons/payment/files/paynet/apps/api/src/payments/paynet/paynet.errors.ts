import { PaymentErrorCode } from '../payment-state';

/**
 * Paynet provider protocol error codes (JSON-RPC 2.0, always HTTP 200).
 * Check them against the protocol document Paynet gives you with the
 * contract (it is not public).
 */
export const PaynetErrorCode = {
  /** Not enough money left to cancel (a wallet top-up already spent). */
  INSUFFICIENT_FUNDS_TO_CANCEL: 77,
  SYSTEM_ERROR: 102,
  TRANSACTION_EXISTS: 201,
  TRANSACTION_CANCELLED: 202,
  TRANSACTION_NOT_FOUND: 203,
  CLIENT_NOT_FOUND: 302,
  MISSING_PARAMS: 411,
  WRONG_LOGIN: 412,
  WRONG_AMOUNT: 413,
  WRONG_DATETIME: 414,
  ACCESS_DENIED: 601,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
} as const;

const MESSAGES: Record<number, string> = {
  [PaynetErrorCode.INSUFFICIENT_FUNDS_TO_CANCEL]: 'Insufficient funds to cancel the payment',
  [PaynetErrorCode.SYSTEM_ERROR]: 'System error',
  [PaynetErrorCode.TRANSACTION_EXISTS]: 'Transaction already exists',
  [PaynetErrorCode.TRANSACTION_CANCELLED]: 'Transaction already cancelled',
  [PaynetErrorCode.TRANSACTION_NOT_FOUND]: 'Transaction not found',
  [PaynetErrorCode.CLIENT_NOT_FOUND]: 'Client not found',
  [PaynetErrorCode.MISSING_PARAMS]: 'Required parameters are missing',
  [PaynetErrorCode.WRONG_LOGIN]: 'Wrong login or password',
  [PaynetErrorCode.WRONG_AMOUNT]: 'Wrong amount',
  [PaynetErrorCode.WRONG_DATETIME]: 'Wrong date and time format',
  [PaynetErrorCode.ACCESS_DENIED]: 'Access denied',
  [PaynetErrorCode.INVALID_REQUEST]: 'Invalid request',
  [PaynetErrorCode.METHOD_NOT_FOUND]: 'Method not found',
};

export class PaynetError extends Error {
  constructor(
    readonly code: number,
    message?: string,
  ) {
    super(message ?? MESSAGES[code] ?? 'Error');
    this.name = 'PaynetError';
  }

  toJSON(): { code: number; message: string } {
    return { code: this.code, message: this.message };
  }
}

/** Core payment errors → Paynet codes. */
export function paynetErrorFor(code: PaymentErrorCode, message: string): PaynetError {
  switch (code) {
    case 'account_not_found':
    case 'already_paid':
    case 'not_payable':
    case 'busy':
      return new PaynetError(PaynetErrorCode.CLIENT_NOT_FOUND, message);
    case 'wrong_amount':
      return new PaynetError(PaynetErrorCode.WRONG_AMOUNT, message);
    case 'transaction_not_found':
      return new PaynetError(PaynetErrorCode.TRANSACTION_NOT_FOUND, message);
    case 'cancel_refused':
      return new PaynetError(PaynetErrorCode.INSUFFICIENT_FUNDS_TO_CANCEL, message);
    case 'invalid_state':
      return new PaynetError(PaynetErrorCode.SYSTEM_ERROR, message);
  }
}
