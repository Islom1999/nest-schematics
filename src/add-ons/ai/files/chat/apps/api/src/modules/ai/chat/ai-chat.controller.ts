import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiPaginatedResponse, DeleteResultDto } from '@app/common';
import { AiChatMessage, AiChatSession } from '@app/database';
import { CurrentUser, UserGuard, UserPrincipal } from '../../../client-auth';
import { AiChatService } from './ai-chat.service';
import { AiChatPageQueryDto, AiChatStreamDto, AiChatStreamEventDto } from './dto/ai-chat.dto';

/**
 * `/api/client/ai/chat`: the signed-in user's AI chat. Answers stream as
 * Server-Sent Events over a POST (read them with fetch + a stream reader, not
 * EventSource).
 */
@ApiTags('client/ai/chat')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('client/ai/chat')
export class AiChatController {
  constructor(private readonly chat: AiChatService) {}

  @Post('stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a message and stream the answer (SSE)',
    description:
      'Events (`event:` line = type, `data:` line = JSON AiChatStreamEvent): ' +
      '`meta` (session and message ids), then `delta` (text pieces), then `done` (usage) or `error`. ' +
      'On `error` the partial answer is saved with status error. Checks that fail before the stream ' +
      'starts answer with a normal JSON error: 404 session, 429 quota, 503 AI not configured.',
  })
  @ApiProduces('text/event-stream')
  @ApiExtraModels(AiChatStreamEventDto)
  @ApiOkResponse({
    description: 'text/event-stream of AiChatStreamEvent: meta, delta..., done or error',
    content: { 'text/event-stream': { schema: { $ref: getSchemaPath(AiChatStreamEventDto) } } },
  })
  @ApiNotFoundResponse({ description: 'Chat session not found' })
  @ApiTooManyRequestsResponse({ description: 'AI usage limit reached (daily messages or monthly tokens)' })
  @ApiServiceUnavailableResponse({ description: 'AI_NOT_CONFIGURED: the provider API key is not set' })
  async stream(@Body() dto: AiChatStreamDto, @CurrentUser() user: UserPrincipal, @Res() res: Response): Promise<void> {
    const abort = new AbortController();
    // The client went away before the answer ended: stop the provider call.
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    const prepared = await this.chat.prepare(user.id, dto, abort.signal);

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // nginx: do not buffer the stream.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    await this.chat.run(prepared, (event) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    if (!res.writableEnded) res.end();
  }

  @Get('sessions')
  @ApiOperation({ summary: "The user's chat sessions, most recent first" })
  @ApiPaginatedResponse(AiChatSession)
  findSessions(@CurrentUser() user: UserPrincipal, @Query() query: AiChatPageQueryDto) {
    return this.chat.listSessions(user.id, query);
  }

  @Get('sessions/:id/messages')
  @ApiOperation({ summary: 'Messages of a session, oldest first' })
  @ApiPaginatedResponse(AiChatMessage)
  @ApiNotFoundResponse({ description: 'Chat session not found' })
  findMessages(@CurrentUser() user: UserPrincipal, @Param('id', ParseUUIDPipe) id: string, @Query() query: AiChatPageQueryDto) {
    return this.chat.listMessages(user.id, id, query);
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Delete a session and its messages' })
  @ApiOkResponse({ type: DeleteResultDto })
  @ApiNotFoundResponse({ description: 'Chat session not found' })
  deleteSession(@CurrentUser() user: UserPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.deleteSession(user.id, id);
  }
}
