import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, UserGuard, UserPrincipal } from '../../client-auth';
import { PageQueryDto } from '../dto/payment.dto';
import { WalletEntryDto, WalletOverviewDto } from './wallet.dto';
import { WalletService } from './wallet.service';

/** `/api/client/wallet`: the signed-in user's balance and ledger. Top up with `POST client/payments/checkout { provider, amount }`. */
@ApiTags('client/wallet')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('client/wallet')
export class ClientWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'My balance (tiyin) and a page of the ledger, newest first' })
  @ApiOkResponse({ type: WalletOverviewDto })
  async overview(@CurrentUser() user: UserPrincipal, @Query() query: PageQueryDto): Promise<WalletOverviewDto> {
    const page = await this.wallet.history(user.id, query.page ?? 1, query.limit ?? 20);
    return { balance: page.balance, count: page.count, data: page.data.map((row) => WalletEntryDto.from(row)) };
  }
}
