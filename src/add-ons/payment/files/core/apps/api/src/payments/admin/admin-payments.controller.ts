import { Body, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AdminAccess, ApiPaginatedResponse, TableQueryDto } from '@app/common';
import { PaymentTransaction } from '@app/database';
import { AdminResource } from '../../auth/admin-resource.decorator';
import type { AdminPrincipal } from '../../auth/auth.types';
import { CurrentAdmin } from '../../auth/current-admin.decorator';
import { CancelPaymentDto } from './admin-payments.dto';
import { AdminPaymentsService } from './admin-payments.service';

/**
 * `/api/admin/payments`: provider transactions (read: `payment.read`, manual
 * cancel: `payment.write`). Table routes match the CRUD ones (PrimeNG lazy table).
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
