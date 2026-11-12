import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '@app/common';
import { InpayService } from './inpay.service';

/**
 * `POST /api/payments/inpay/webhook`: the inPAY callback (INPAY_CALLBACK_URL
 * or the cabinet setting). Public, not rate limited, not in Swagger. The body
 * is not signed, so it is never trusted: the order state is fetched from the
 * inPAY API again. 200 `{ success: true }` once handled; 502 when the inPAY API
 * fails (inPAY retries); 503 when inPAY is not configured.
 * INPAY_ALLOWED_IPS checks `req.ip`: behind a proxy set TRUST_PROXY.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
// @ns:payment-log (api-logs puts its payment log decorator here)
@Controller('payments/inpay')
export class InpayController {
  constructor(private readonly inpay: InpayService) {}

  @Post('webhook')
  @HttpCode(200)
  webhook(@Body() body: unknown, @Req() req: Request): Promise<{ success: true }> {
    return this.inpay.handleWebhook(body, req.ip ?? req.socket.remoteAddress ?? '');
  }
}
