import { Body, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AdminAccess, ApiPaginatedResponse, TableQueryDto } from '@app/common';
import { Wallet, WalletTransaction } from '@app/database';
import { AdminResource } from '../../auth/admin-resource.decorator';
import type { AdminPrincipal } from '../../auth/auth.types';
import { CurrentAdmin } from '../../auth/current-admin.decorator';
import { PageQueryDto } from '../dto/payment.dto';
import { AdminWalletsService } from './admin-wallets.service';
import { AdjustWalletDto, ReverseWalletTransactionDto } from './wallet.dto';

/**
 * `/api/admin/wallets`: balances (read: `payment.read`), manual adjustments
 * with a note and reversals of ledger rows with a comment (`payment.write`).
 * Both lock the wallet like every other balance change and never overdraw it.
 */
@AdminResource('wallets', { read: ['payment.read'], write: ['payment.write'] })
export class AdminWalletsController {
  constructor(private readonly service: AdminWalletsService) {}

  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('pagination')
  @ApiOperation({ summary: 'Paged wallets with their users (PrimeNG lazy table)' })
  @ApiPaginatedResponse(Wallet)
  findAllPagination(@Body() query: TableQueryDto) {
    return this.service.findAllPagination(query, true);
  }

  @AdminAccess('write')
  @HttpCode(HttpStatus.OK)
  @Post('adjust')
  @ApiOperation({ summary: "Add to or take from a user's balance (creates the wallet on first use)" })
  @ApiOkResponse({ type: WalletTransaction })
  adjust(@Body() dto: AdjustWalletDto, @CurrentAdmin() admin: AdminPrincipal): Promise<WalletTransaction> {
    return this.service.adjust(dto.userId, dto.amount, dto.note, admin.id);
  }

  @AdminAccess('write')
  @HttpCode(HttpStatus.OK)
  @Post('transactions/:id/reverse')
  @ApiOperation({
    summary: 'Reverse one ledger row (adjust, purchase, refund) with a reversal row of the opposite amount',
    description:
      'Once per row: a second reversal is 409 already_reversed. 409 insufficient_funds when the balance would go negative, ' +
      '409 not_reversible for reversal rows and rows of provider payments (cancel the payment instead).',
  })
  @ApiOkResponse({ type: WalletTransaction })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseWalletTransactionDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<WalletTransaction> {
    return this.service.reverse(id, dto.comment, admin.id);
  }

  @AdminAccess('read')
  @Get(':id')
  @ApiOperation({ summary: 'One wallet' })
  @ApiOkResponse({ type: Wallet })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id, true);
  }

  @AdminAccess('read')
  @Get(':id/transactions')
  @ApiOperation({ summary: 'Ledger of a wallet, newest first' })
  @ApiPaginatedResponse(WalletTransaction)
  transactions(@Param('id', ParseUUIDPipe) id: string, @Query() query: PageQueryDto) {
    return this.service.transactions(id, query.page ?? 1, query.limit ?? 20);
  }
}
