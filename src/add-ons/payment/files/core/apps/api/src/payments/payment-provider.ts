import { Injectable } from '@nestjs/common';
import { PaymentInvoice } from '@app/database';

/**
 * What the core needs from a provider (`payments/<provider>/<provider>.service.ts`).
 * Each provider service implements it and registers itself in
 * `onModuleInit`; its webhook controller talks to PaymentsService.
 */
export interface PaymentProviderAdapter {
  /** PaymentProvider value (`payme`, `click`...). */
  readonly provider: string;
  /** Keys are set: checkout works (otherwise 503) and webhooks are accepted. */
  isConfigured(): boolean;
  /** URL of the provider's pay page for an invoice. */
  payUrl(invoice: PaymentInvoice): string;
  /** Provider `state` code of a transaction cancelled by an admin (`paid` = it was paid before). */
  cancelState(paid: boolean): number;
  /**
   * Paid payments the provider will not reverse through its webhooks can be
   * cancelled by an admin once the money is returned in the provider's
   * cabinet (`refundedExternally`). False: the provider calls us itself.
   */
  readonly manualRefund: boolean;
  /** Admin message when a paid payment cannot be cancelled here. */
  readonly refundHint: string;
}

@Injectable()
export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProviderAdapter>();

  register(adapter: PaymentProviderAdapter): void {
    this.providers.set(adapter.provider, adapter);
  }

  get(provider: string): PaymentProviderAdapter | undefined {
    return this.providers.get(provider);
  }

  list(): PaymentProviderAdapter[] {
    return [...this.providers.values()];
  }
}
