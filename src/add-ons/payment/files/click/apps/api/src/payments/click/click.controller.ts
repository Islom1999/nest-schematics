import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '@app/common';
import { ClickRequest, ClickResponse, ClickService } from './click.service';

/**
 * Click SHOP API endpoints (set them in the Click merchant cabinet):
 *   Prepare URL:  https://<host>/api/payments/click/prepare
 *   Complete URL: https://<host>/api/payments/click/complete
 * Public, not rate limited, not in Swagger: every request is checked by its
 * MD5 `sign_string`. Always HTTP 200 with `error` (0 = success).
 * CLICK_ALLOWED_IPS checks `req.ip`: behind a proxy set TRUST_PROXY.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
// @ns:payment-log (api-logs puts its payment log decorator here)
@Controller('payments/click')
export class ClickController {
  constructor(private readonly click: ClickService) {}

  @Post('prepare')
  @HttpCode(200)
  prepare(@Body() body: unknown, @Req() req: Request): Promise<ClickResponse> {
    return this.click.prepare(asRequest(body), req.ip ?? req.socket.remoteAddress ?? '');
  }

  @Post('complete')
  @HttpCode(200)
  complete(@Body() body: unknown, @Req() req: Request): Promise<ClickResponse> {
    return this.click.complete(asRequest(body), req.ip ?? req.socket.remoteAddress ?? '');
  }
}

function asRequest(body: unknown): ClickRequest {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as ClickRequest) : {};
}
