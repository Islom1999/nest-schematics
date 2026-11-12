import { SetMetadata } from '@nestjs/common';

export const LOG_PAYMENT_KEY = 'apiLog:payment';

export interface LogPaymentOptions {
  /** Module name stored in the log (default: the controller class name). */
  module?: string;
}

/**
 * Logs every call of a route (or every route of a controller) as `PAYMENT`,
 * successful or not, with the masked request and response bodies, whatever
 * API_LOG_MODE is. Use it on payment provider webhooks and checkout routes.
 *
 *   @LogPayment({ module: 'payme' })
 *   @Post('payme')
 *   handle(@Body() body: PaymeRequest) { ... }
 */
export const LogPayment = (options: LogPaymentOptions = {}) => SetMetadata(LOG_PAYMENT_KEY, options);
