import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, PaginatedResult } from '@app/common';
import { CurrentUser, UserGuard, UserPrincipal } from '../client-auth';
import { CheckoutDto, CheckoutResponseDto, ClientPaymentDto, PageQueryDto } from './dto/payment.dto';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

/**
 * `/api/client/payments`: checkout (an invoice + the provider's pay URL) and
 * the signed-in user's payments. Amounts are in tiyin.
 */
@ApiTags('client/payments')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('client/payments')
export class ClientPaymentsController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
  ) {}

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create an invoice: top up (amount) or pay a target (targetType + targetId); 503 = provider not configured' })
  @ApiOkResponse({ type: CheckoutResponseDto })
  checkout(@CurrentUser() user: UserPrincipal, @Body() dto: CheckoutDto): Promise<CheckoutResponseDto> {
    return this.invoices.checkout(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'My payments, newest first' })
  @ApiPaginatedResponse(ClientPaymentDto)
  async findMine(@CurrentUser() user: UserPrincipal, @Query() query: PageQueryDto): Promise<PaginatedResult<ClientPaymentDto>> {
    const [rows, count] = await this.payments.listForUser(user.id, query.page ?? 1, query.limit ?? 20);
    return { count, data: rows.map((tx) => ClientPaymentDto.from(tx)) };
  }
}
