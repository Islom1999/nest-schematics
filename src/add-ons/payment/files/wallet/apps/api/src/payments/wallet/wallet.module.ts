import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, Wallet, WalletTransaction } from '@app/database';
import { AdminWalletsController } from './admin-wallets.controller';
import { AdminWalletsService } from './admin-wallets.service';
import { ClientWalletController } from './client-wallet.controller';
import { WalletTopupTarget } from './wallet-topup.target';
import { WalletService } from './wallet.service';

/**
 * Wallet mode (`npm run g -- payment <provider> --mode wallet`): balances,
 * the ledger, top-ups (the `wallet` PaymentTarget), `client/wallet` and
 * `admin/wallets`. Global: inject WalletService anywhere to sell from the balance.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Wallet, WalletTransaction, User])],
  controllers: [ClientWalletController, AdminWalletsController],
  providers: [WalletService, WalletTopupTarget, AdminWalletsService],
  exports: [WalletService],
})
export class WalletModule {}
