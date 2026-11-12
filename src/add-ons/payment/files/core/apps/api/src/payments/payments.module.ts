import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentInvoice, PaymentTransaction } from '@app/database';
import { AdminPaymentsController } from './admin/admin-payments.controller';
import { AdminPaymentsService } from './admin/admin-payments.service';
import { ClientPaymentsController } from './client-payments.controller';
import { InvoicesService } from './invoices.service';
import { PaymentProviderRegistry } from './payment-provider';
import { PaymentTargetRegistry } from './payment-target';
import { PaymentsService } from './payments.service';

/**
 * Payments core (`npm run g -- payment <provider>`): invoices, the transaction
 * state machine, checkout and admin routes. Provider webhooks (controllers +
 * services) are added here by the generator. Global, so app modules can
 * inject PaymentTargetRegistry (and WalletService from WalletModule) directly.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PaymentInvoice, PaymentTransaction])],
  controllers: [ClientPaymentsController, AdminPaymentsController],
  providers: [PaymentTargetRegistry, PaymentProviderRegistry, PaymentsService, InvoicesService, AdminPaymentsService],
  exports: [PaymentTargetRegistry, PaymentProviderRegistry, PaymentsService],
})
export class PaymentsModule {}
