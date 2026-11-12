import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '@app/common';
import { PaynetResponse, PaynetService } from './paynet.service';

/**
 * `POST /api/payments/paynet`: the Paynet provider endpoint (give it to Paynet
 * when the service is set up). Public, not rate limited, not in Swagger:
 * Paynet authenticates with Basic `PAYNET_LOGIN:PAYNET_PASSWORD`. Always HTTP 200.
 * PAYNET_ALLOWED_IPS checks `req.ip`: behind a proxy set TRUST_PROXY.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
// @ns:payment-log (api-logs puts its payment log decorator here)
@Controller('payments/paynet')
export class PaynetController {
  constructor(private readonly paynet: PaynetService) {}

  @Post()
  @HttpCode(200)
  handle(@Body() body: unknown, @Headers('authorization') authorization: string | undefined, @Req() req: Request): Promise<PaynetResponse> {
    return this.paynet.handle(body, authorization, req.ip ?? req.socket.remoteAddress ?? '');
  }
}
