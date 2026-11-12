import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';

/** Postgres error codes → HTTP status + safe message (driver text is never sent). */
const PG_ERRORS: Record<string, [number, string]> = {
  '23505': [HttpStatus.CONFLICT, 'Duplicate value: a record with this value already exists'],
  '23503': [HttpStatus.CONFLICT, 'The record is referenced by (or references) another record'],
  '23502': [HttpStatus.BAD_REQUEST, 'A required value is missing'],
  '22P02': [HttpStatus.BAD_REQUEST, 'Invalid value format'],
  '22001': [HttpStatus.BAD_REQUEST, 'Value is too long'],
};

/**
 * One error shape for the whole API:
 *   { statusCode, error, message, path, timestamp }
 * `message` is a string or (validation) string[]. TypeORM errors are mapped
 * to 4xx where it makes sense; anything unexpected is a logged 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    if (res.headersSent) return;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: unknown = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? exception.message);
    } else if (exception instanceof QueryFailedError) {
      const code = (exception as QueryFailedError & { code?: string }).code ?? '';
      const mapped = PG_ERRORS[code];
      if (mapped) {
        [status, message] = mapped;
      } else {
        this.logger.error(exception.message, exception.stack);
      }
    } else if (exception instanceof EntityNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      message = 'Record not found';
    } else {
      const err = exception as Error;
      this.logger.error(err?.message ?? String(exception), err?.stack);
    }

    res.status(status).json({
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
