import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '@app/common';
import { TUS_HOOK_SECRET_HEADER } from '@app/common/media/tus';
import { TusHookRequest, TusHookResponse, TusHooksService } from './tus-hooks.service';

/**
 * `POST /api/internal/tus-hooks`: tusd's HTTP hooks (`-hooks-http`). Not for
 * clients: excluded from Swagger, guarded by TUS_HOOK_SECRET (header
 * X-Tus-Hook-Secret, compared in constant time) or, without a secret, by a
 * private-network check. Do not route `/api/internal/*` through your public
 * proxy. Always answers 200 + JSON (tusd's hook response format); a refused
 * upload is `RejectUpload` with the HTTP status the client gets.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('internal/tus-hooks')
export class TusHooksController {
  constructor(private readonly hooks: TusHooksService) {}

  @Post()
  @HttpCode(200)
  handle(
    @Req() req: Request,
    @Headers(TUS_HOOK_SECRET_HEADER) secret: string | undefined,
    @Body() hook: TusHookRequest,
  ): Promise<TusHookResponse> {
    // The socket address, not X-Forwarded-For: tusd talks to the api directly.
    this.hooks.assertTrusted(secret, req.socket.remoteAddress);
    return this.hooks.handle(hook);
  }
}
