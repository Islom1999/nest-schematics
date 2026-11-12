import { PaymentErrorCode } from '../payment-state';

/**
 * Uzum Bank Merchant API `errorCode` values (answered with HTTP 400 and
 * `status: "FAILED"`). Check them against the documentation Uzum gives you
 * with the merchant contract (developer.uzumbank.uz/merchant).
 */
export const UzumErrorCode = {
  ACCESS_DENIED: '10001',
  JSON_PARSING_ERROR: '10002',
  INVALID_OPERATION: '10003',
  MISSING_PARAMS: '10005',
  INVALID_SERVICE_ID: '10006',
  ALREADY_PAID: '10007',
  NOT_FOUND: '10008',
  CANCELLED: '10009',
  DATA_CHECK_ERROR: '99999',
} as const;

export type UzumErrorCodeValue = (typeof UzumErrorCode)[keyof typeof UzumErrorCode];

export class UzumError extends Error {
  constructor(
    readonly code: UzumErrorCodeValue,
    message = 'Uzum request refused',
  ) {
    super(message);
    this.name = 'UzumError';
  }
}

/** Core payment errors → Uzum codes. */
export function uzumErrorFor(code: PaymentErrorCode, message: string): UzumError {
  switch (code) {
    case 'account_not_found':
    case 'transaction_not_found':
      return new UzumError(UzumErrorCode.NOT_FOUND, message);
    case 'already_paid':
      return new UzumError(UzumErrorCode.ALREADY_PAID, message);
    case 'not_payable':
    case 'invalid_state':
      return new UzumError(UzumErrorCode.CANCELLED, message);
    case 'wrong_amount':
    case 'busy':
    case 'cancel_refused':
      return new UzumError(UzumErrorCode.DATA_CHECK_ERROR, message);
  }
}
