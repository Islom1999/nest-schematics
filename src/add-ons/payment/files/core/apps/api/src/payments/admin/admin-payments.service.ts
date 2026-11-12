import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseCrudService } from '@app/common';
import { PaymentStatus, PaymentTransaction } from '@app/database';
import { PaymentProviderRegistry } from '../payment-provider';
import { PaymentError } from '../payment-state';
import { PaymentsService } from '../payments.service';
import { CancelPaymentDto } from './admin-payments.dto';

/**
 * `admin/payments`: the transactions table and manual cancel.
 * - pending: cancelled here (the provider's later perform/complete is refused);
 * - paid: only for providers with `manualRefund` (Click), after the money was
 *   returned in the provider's cabinet (`refundedExternally: true`); the
 *   wallet top-up / target is reversed like a provider cancel. Payme refunds
 *   are made in the Payme Business cabinet, which then calls CancelTransaction.
 */
@Injectable()
export class AdminPaymentsService extends BaseCrudService<PaymentTransaction> {
  protected override alias = 'payment';
  protected override notFoundMessage = 'Payment not found';

  constructor(
    @InjectRepository(PaymentTransaction) repository: Repository<PaymentTransaction>,
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderRegistry,
  ) {
    super(repository);
    this.tableOptions = {
      searchFields: ['externalId', 'account', 'provider', 'targetId'],
      defaultSort: { field: 'createdAt', order: 'DESC' },
    };
  }

  async cancel(id: string, dto: CancelPaymentDto, adminId: string): Promise<PaymentTransaction> {
    const tx = await this.payments.findById(id);
    if (!tx) throw new NotFoundException(this.notFoundMessage);
    const adapter = this.providers.get(tx.provider);
    if (!adapter) throw new ConflictException(`Provider "${tx.provider}" is not installed`);
    const paid = tx.status === PaymentStatus.PAID;
    if (paid && !adapter.manualRefund) throw new ConflictException(adapter.refundHint);
    if (paid && dto.refundedExternally !== true) {
      throw new BadRequestException('Return the money in the provider cabinet first, then send refundedExternally: true');
    }
    if (!paid && tx.status !== PaymentStatus.PENDING) throw new ConflictException(`The payment is ${tx.status} already`);
    try {
      return await this.payments.transition(tx.id, PaymentStatus.CANCELLED, {
        state: (from) => adapter.cancelState(from === PaymentStatus.PAID),
        // The status checked above must still hold (a callback may have come in between).
        onlyFrom: [tx.status],
        raw: { adminCancel: { adminId, comment: dto.comment, refundedExternally: paid, at: new Date().toISOString() } },
      });
    } catch (error) {
      if (error instanceof PaymentError) throw new ConflictException(error.message);
      throw error;
    }
  }
}
