import { PaymentErrorCode } from '../payment-state';

/** Payme Merchant API error codes (developer.help.paycom.uz → "Ошибки"). */
export const PaymeErrorCode = {
  /** Request method is not POST. */
  METHOD_NOT_POST: -32300,
  PARSE_ERROR: -32700,
  /** Required fields are missing or have wrong types. */
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  /** Wrong Basic auth (or IP not allowed, or Payme keys not set). */
  INSUFFICIENT_PRIVILEGE: -32504,
  SYSTEM_ERROR: -32400,
  WRONG_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  /** The order is completed: a performed transaction cannot be cancelled. */
  CANNOT_CANCEL: -31007,
  /** The transaction state does not allow the operation. */
  CANNOT_PERFORM: -31008,
  /** -31050..-31099: wrong `account`. Ours: */
  ACCOUNT_NOT_FOUND: -31050,
  ACCOUNT_NOT_PAYABLE: -31051,
  ACCOUNT_BUSY: -31052,
} as const;

export interface PaymeMessage {
  ru: string;
  uz: string;
  en: string;
}

const MESSAGES: Record<number, PaymeMessage> = {
  [PaymeErrorCode.METHOD_NOT_POST]: { ru: 'Метод запроса не POST', uz: "So'rov usuli POST emas", en: 'Request method is not POST' },
  [PaymeErrorCode.PARSE_ERROR]: { ru: 'Ошибка парсинга JSON', uz: 'JSON tahlil xatosi', en: 'JSON parse error' },
  [PaymeErrorCode.INVALID_REQUEST]: {
    ru: 'Неверный JSON-RPC запрос',
    uz: "JSON-RPC so'rovi noto'g'ri",
    en: 'Invalid JSON-RPC request',
  },
  [PaymeErrorCode.METHOD_NOT_FOUND]: { ru: 'Метод не найден', uz: 'Metod topilmadi', en: 'Method not found' },
  [PaymeErrorCode.INSUFFICIENT_PRIVILEGE]: {
    ru: 'Недостаточно привилегий для выполнения метода',
    uz: 'Metodni bajarish uchun huquqlar yetarli emas',
    en: 'Insufficient privileges to execute the method',
  },
  [PaymeErrorCode.SYSTEM_ERROR]: { ru: 'Системная ошибка', uz: 'Tizim xatosi', en: 'System error' },
  [PaymeErrorCode.WRONG_AMOUNT]: { ru: 'Неверная сумма', uz: "Noto'g'ri summa", en: 'Wrong amount' },
  [PaymeErrorCode.TRANSACTION_NOT_FOUND]: { ru: 'Транзакция не найдена', uz: 'Tranzaksiya topilmadi', en: 'Transaction not found' },
  [PaymeErrorCode.CANNOT_CANCEL]: {
    ru: 'Невозможно отменить транзакцию: услуга предоставлена',
    uz: "Tranzaksiyani bekor qilib bo'lmaydi: xizmat ko'rsatilgan",
    en: 'Unable to cancel the transaction: the service is provided',
  },
  [PaymeErrorCode.CANNOT_PERFORM]: {
    ru: 'Невозможно выполнить операцию',
    uz: "Amalni bajarib bo'lmaydi",
    en: 'Unable to perform the operation',
  },
  [PaymeErrorCode.ACCOUNT_NOT_FOUND]: { ru: 'Счёт не найден', uz: 'Hisob topilmadi', en: 'Account not found' },
  [PaymeErrorCode.ACCOUNT_NOT_PAYABLE]: {
    ru: 'Счёт уже оплачен или недоступен для оплаты',
    uz: "Hisob to'langan yoki to'lab bo'lmaydi",
    en: 'The invoice is paid or cannot be paid',
  },
  [PaymeErrorCode.ACCOUNT_BUSY]: {
    ru: 'Счёт ожидает оплаты другой транзакцией',
    uz: "Hisob boshqa tranzaksiya orqali to'lovni kutmoqda",
    en: 'Another transaction is waiting for this invoice',
  },
};

/** An error answered as `{ error: { code, message: { ru, uz, en }, data } }` with HTTP 200. */
export class PaymeError extends Error {
  constructor(
    readonly code: number,
    readonly data?: string,
  ) {
    super(MESSAGES[code]?.en ?? 'Error');
    this.name = 'PaymeError';
  }

  toJSON(): { code: number; message: PaymeMessage; data?: string } {
    return {
      code: this.code,
      message: MESSAGES[this.code] ?? MESSAGES[PaymeErrorCode.SYSTEM_ERROR],
      ...(this.data !== undefined ? { data: this.data } : {}),
    };
  }
}

/** Core payment errors → Payme codes (`field` = the account field, sent as `data`). */
export function paymeErrorFor(code: PaymentErrorCode, field: string): PaymeError {
  switch (code) {
    case 'wrong_amount':
      return new PaymeError(PaymeErrorCode.WRONG_AMOUNT);
    case 'account_not_found':
      return new PaymeError(PaymeErrorCode.ACCOUNT_NOT_FOUND, field);
    case 'already_paid':
    case 'not_payable':
      return new PaymeError(PaymeErrorCode.ACCOUNT_NOT_PAYABLE, field);
    case 'busy':
      return new PaymeError(PaymeErrorCode.ACCOUNT_BUSY, field);
    case 'transaction_not_found':
      return new PaymeError(PaymeErrorCode.TRANSACTION_NOT_FOUND);
    case 'cancel_refused':
      return new PaymeError(PaymeErrorCode.CANNOT_CANCEL);
    case 'invalid_state':
      return new PaymeError(PaymeErrorCode.CANNOT_PERFORM);
  }
}
