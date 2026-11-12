import { Body, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminAccess, ApiPaginatedResponse, TableQueryDto } from '@app/common';
import { PaymentInvoice, PaymentTransaction } from '@app/database';
import { AdminResource } from '../../auth/admin-resource.decorator';
import type { AdminPrincipal } from '../../auth/auth.types';
import { CurrentAdmin } from '../../auth/current-admin.decorator';
import {
  CancelPaymentDto,
  ExportPaymentsQueryDto,
  PaymentInvoiceDetailDto,
  PaymentPeriodQueryDto,
  PaymentSummaryDto,
} from './admin-payments.dto';
import { AdminPaymentsService, PAYMENT_EXPORT_MAX_ROWS } from './admin-payments.service';

/**
 * `/api/admin/payments`: provider transactions, invoices, the summary and
 * the CSV export (read: `payment.read`), manual cancel (`payment.write`).
 * Table routes match the CRUD ones (PrimeNG lazy table). The fixed paths
 * (`summary`, `export`, `invoices/...`) come before `:id`.
 */
@AdminResource('payments', { read: ['payment.read'], write: ['payment.write'] })
export class AdminPaymentsController {
  constructor(private readonly service: AdminPaymentsService) {}

  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('pagination')
  @ApiOperation({ summary: 'Paged payment transactions (PrimeNG lazy table)' })
  @ApiPaginatedResponse(PaymentTransaction)
  findAllPagination(@Body() query: TableQueryDto) {
    return this.service.findAllPagination(query, true);
  }

  @AdminAccess('read')
  @Get('summary')
  @ApiOperation({ summary: 'Revenue and counts by status and by provider (tiyin), by createdAt in [from, to)' })
  @ApiOkResponse({ type: PaymentSummaryDto })
  summary(@Query() query: PaymentPeriodQueryDto): Promise<PaymentSummaryDto> {
    return this.service.summary(query);
  }

  @AdminAccess('read')
  @Get('export')
  @ApiOperation({
    summary: `CSV of the transactions matching the list filters (at most ${PAYMENT_EXPORT_MAX_ROWS} rows)`,
    description: 'Cells that start like a formula (=, +, -, @) are prefixed with an apostrophe.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'text/csv (attachment)',
    schema: { type: 'string' },
    headers: {
      'X-Total-Count': { description: 'Rows matching the filters', schema: { type: 'integer' } },
      'X-Export-Truncated': { description: 'true: more rows match than the file holds', schema: { type: 'boolean' } },
    },
  })
  async export(@Query() query: ExportPaymentsQueryDto, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const file = await this.service.exportCsv(query);
    res.setHeader('X-Total-Count', String(file.total));
    res.setHeader('X-Export-Truncated', String(file.truncated));
    res.setHeader('Cache-Control', 'no-store');
    const name = `payments-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    return new StreamableFile(file.stream, { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${name}"` });
  }

  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('invoices/pagination')
  @ApiOperation({ summary: 'Paged checkout invoices (PrimeNG lazy table)' })
  @ApiPaginatedResponse(PaymentInvoice)
  findInvoices(@Body() query: TableQueryDto) {
    return this.service.findInvoices(query);
  }

  @AdminAccess('read')
  @Get('invoices/:id')
  @ApiOperation({ summary: 'One invoice with its provider transactions' })
  @ApiOkResponse({ type: PaymentInvoiceDetailDto })
  findInvoice(@Param('id', ParseUUIDPipe) id: string): Promise<PaymentInvoiceDetailDto> {
    return this.service.findInvoice(id);
  }

  @AdminAccess('read')
  @Get(':id')
  @ApiOperation({ summary: 'One payment transaction with the provider requests (raw)' })
  @ApiOkResponse({ type: PaymentTransaction })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id, true);
  }

  @AdminAccess('write')
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a pending payment, or a paid one already refunded in the provider cabinet (Click)' })
  @ApiOkResponse({ type: PaymentTransaction })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelPaymentDto, @CurrentAdmin() admin: AdminPrincipal) {
    return this.service.cancel(id, dto, admin.id);
  }
}
