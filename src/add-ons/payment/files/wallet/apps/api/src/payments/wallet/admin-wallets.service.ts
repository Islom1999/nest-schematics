import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseCrudService, PaginatedResult } from '@app/common';
import { User, Wallet, WalletTransaction } from '@app/database';
import { WalletService } from './wallet.service';

/** `admin/wallets`: balances with their users, the ledger, manual adjustments and reversals. */
@Injectable()
export class AdminWalletsService extends BaseCrudService<Wallet> {
  protected override alias = 'wallet';
  protected override relations = ['user'];
  protected override notFoundMessage = 'Wallet not found';

  constructor(
    @InjectRepository(Wallet) repository: Repository<Wallet>,
    @InjectRepository(WalletTransaction) private readonly ledger: Repository<WalletTransaction>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly wallet: WalletService,
  ) {
    super(repository);
    this.tableOptions = {
      searchFields: ['user.name', 'user.accountNo'],
      defaultSort: { field: 'updatedAt', order: 'DESC' },
    };
  }

  async transactions(id: string, page: number, limit: number): Promise<PaginatedResult<WalletTransaction>> {
    await this.getRaw(id);
    const [data, count] = await this.ledger.findAndCount({
      where: { walletId: id },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { count, data };
  }

  async adjust(userId: string, amount: number, note: string, adminId: string): Promise<WalletTransaction> {
    if (!(await this.users.exists({ where: { id: userId } }))) throw new NotFoundException('User not found');
    return this.wallet.adjust(userId, amount, `${note} (admin ${adminId})`);
  }

  /** The admin id goes into the ledger note next to the comment (audit). */
  reverse(transactionId: string, comment: string, adminId: string): Promise<WalletTransaction> {
    return this.wallet.reverse(transactionId, `${comment} (admin ${adminId})`);
  }
}
