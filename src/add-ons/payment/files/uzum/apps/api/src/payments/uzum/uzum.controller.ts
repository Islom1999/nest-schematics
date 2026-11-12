import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '@app/common';
import { UzumOperation, UzumService } from './uzum.service';

type Reply = Record<string, unknown>;

/**
 * Uzum Bank Merchant API webhooks (set them in the Uzum merchant cabinet):
 *   https://<host>/api/payments/uzum/check | create | confirm | reverse | status
 * Public, not rate limited, not in Swagger: Uzum authenticates with Basic
 * `UZUM_LOGIN:UZUM_PASSWORD`. 200 on success, 400 with `errorCode` otherwise.
 * UZUM_ALLOWED_IPS checks `req.ip`: behind a proxy set TRUST_PROXY.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
// @ns:payment-log (api-logs puts its payment log decorator here)
@Controller('payments/uzum')
export class UzumController {
  constructor(private readonly uzum: UzumService) {}

  @Post('check')
  @HttpCode(200)
  check(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Reply> {
    return this.reply('check', body, req, res);
  }

  @Post('create')
  @HttpCode(200)
  create(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Reply> {
    return this.reply('create', body, req, res);
  }

  @Post('confirm')
  @HttpCode(200)
  confirm(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Reply> {
    return this.reply('confirm', body, req, res);
  }

  @Post('reverse')
  @HttpCode(200)
  reverse(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Reply> {
    return this.reply('reverse', body, req, res);
  }

  @Post('status')
  @HttpCode(200)
  status(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Reply> {
    return this.reply('status', body, req, res);
  }

  private async reply(operation: UzumOperation, body: unknown, req: Request, res: Response): Promise<Reply> {
    const ip = req.ip ?? req.socket.remoteAddress ?? '';
    const result = await this.uzum.handle(operation, body, req.headers.authorization, ip);
    res.status(result.httpStatus);
    return result.body;
  }
}
