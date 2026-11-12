import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '@app/common';
import { PaymeResponse, PaymeService } from './payme.service';

/**
 * `POST /api/payments/payme`: the Payme Merchant API endpoint (set it as the
 * cashbox "endpoint URL" in Payme Business). Public, not rate limited, not in
 * Swagger: Payme authenticates with Basic `Paycom:<PAYME_KEY>`. Always HTTP 200.
 * PAYME_ALLOWED_IPS checks `req.ip`: behind a proxy set TRUST_PROXY.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
// @ns:payment-log (api-logs puts its payment log decorator here)
@Controller('payments/payme')
export class PaymeController {
  constructor(private readonly payme: PaymeService) {}

  @Post()
  @HttpCode(200)
  handle(@Body() body: unknown, @Headers('authorization') authorization: string | undefined, @Req() req: Request): Promise<PaymeResponse> {
    return this.payme.handle(body, authorization, req.ip ?? req.socket.remoteAddress ?? '');
  }
}
