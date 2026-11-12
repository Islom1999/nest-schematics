import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentInvoice, PaymentInvoiceStatus, PaymentPurpose } from '@app/database';
import { CheckoutDto, CheckoutResponseDto } from './dto/payment.dto';
import { PaymentProviderRegistry } from './payment-provider';
import { PaymentTargetRegistry, WALLET_TARGET } from './payment-target';
import { PaymentsService } from './payments.service';

/**
 * `POST client/payments/checkout`: creates a `payment_invoices` row and the
 * provider's pay URL. The provider's account parameter is the invoice number.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderRegistry,
    private readonly targets: PaymentTargetRegistry,
  ) {}

  async checkout(userId: string, dto: CheckoutDto): Promise<CheckoutResponseDto> {
    const adapter = this.providers.get(dto.provider);
    if (!adapter) throw new BadRequestException(`Unknown payment provider "${dto.provider}"`);
    if (!adapter.isConfigured()) throw new ServiceUnavailableException(`${dto.provider} payments are not configured`);

    const hasTarget = dto.targetType !== undefined || dto.targetId !== undefined;
    if (dto.amount !== undefined && hasTarget) {
      throw new BadRequestException('Send either amount (top-up) or targetType + targetId, not both');
    }

    let purpose: PaymentPurpose;
    let amount: number;
    let targetType: string;
    let targetId: string;
    if (dto.amount !== undefined) {
      if (!this.targets.has(WALLET_TARGET)) throw new BadRequestException('Wallet top-ups are not enabled');
      const { minAmount, maxAmount } = this.payments.settings;
      if (dto.amount < minAmount || dto.amount > maxAmount) {
        throw new BadRequestException(`amount must be between ${minAmount} and ${maxAmount} tiyin`);
      }
      purpose = PaymentPurpose.TOPUP;
      amount = dto.amount;
      targetType = WALLET_TARGET;
      targetId = userId;
    } else {
      if (!dto.targetType || !dto.targetId) throw new BadRequestException('Send amount, or targetType and targetId');
      const target = dto.targetType === WALLET_TARGET ? undefined : this.targets.get(dto.targetType);
      if (!target) throw new BadRequestException(`Unknown payment target "${dto.targetType}"`);
      const info = await target.resolve(dto.targetId);
      if (!info || (info.userId && info.userId !== userId)) throw new NotFoundException('Payment target not found');
      if (!info.payable) throw new ConflictException('This cannot be paid now');
      if (!Number.isSafeInteger(info.amount) || info.amount <= 0) throw new ConflictException('Nothing to pay');
      purpose = PaymentPurpose.ORDER;
      amount = info.amount;
      targetType = dto.targetType;
      targetId = dto.targetId;
    }

    const repository = this.dataSource.getRepository(PaymentInvoice);
    const saved = await repository.save(
      repository.create({
        userId,
        amount,
        purpose,
        targetType,
        targetId,
        status: PaymentInvoiceStatus.PENDING,
        provider: dto.provider,
        expiresAt: new Date(Date.now() + this.payments.settings.invoiceTtlMinutes * 60_000),
        paidAt: null,
      }),
    );
    // `number` comes from the database sequence.
    const invoice = await repository.findOneByOrFail({ id: saved.id });
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: invoice.amount,
      status: invoice.status,
      expiresAt: invoice.expiresAt,
      payUrl: await adapter.payUrl(invoice),
    };
  }
}
