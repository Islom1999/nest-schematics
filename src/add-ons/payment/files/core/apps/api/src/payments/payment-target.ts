import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PaymentTransaction } from '@app/database';

/** Target type of wallet top-ups (registered by WalletModule in `--mode wallet`); its id is the user id. */
export const WALLET_TARGET = 'wallet';

export interface PaymentTargetInfo {
  /** Amount to pay, tiyin. */
  amount: number;
  /** Owner: only this user may pay it (null / undefined = anyone signed in). */
  userId?: string | null;
  /** False when the target cannot be paid now (already paid, cancelled, out of stock...). */
  payable: boolean;
}

/**
 * Something a payment pays for: an order, a subscription, a booking... App
 * code implements it and registers it, then clients pay it with
 * `POST client/payments/checkout { provider, targetType, targetId }`.
 *
 * `onPaid` / `onCancelled` run inside the payment's database transaction
 * (use `manager`, not your own repositories, so everything commits together).
 * `onCancelled` runs when a PAID payment is reversed (Payme cancel after
 * perform, an admin refund); throw PaymentCancelRefusedError to refuse it
 * (Payme then gets -31007 and the payment stays paid).
 *
 * Example (`--mode order`), in your own module:
 *
 *   @Injectable()
 *   export class OrderPaymentTarget implements PaymentTarget, OnModuleInit {
 *     readonly type = 'order';
 *
 *     constructor(
 *       private readonly targets: PaymentTargetRegistry,
 *       @InjectRepository(Order) private readonly orders: Repository<Order>,
 *     ) {}
 *
 *     onModuleInit() {
 *       this.targets.register(this);
 *     }
 *
 *     async resolve(id: string) {
 *       const order = await this.orders.findOneBy({ id });
 *       return order && { amount: order.total, userId: order.userId, payable: order.status === 'new' };
 *     }
 *
 *     async onPaid(id: string, tx: PaymentTransaction, manager: EntityManager) {
 *       await manager.update(Order, id, { status: 'paid', paymentId: tx.id });
 *     }
 *
 *     async onCancelled(id: string, tx: PaymentTransaction, manager: EntityManager) {
 *       const order = await manager.findOneByOrFail(Order, { id });
 *       if (order.status === 'shipped') throw new PaymentCancelRefusedError('The order is shipped');
 *       await manager.update(Order, id, { status: 'cancelled' });
 *     }
 *   }
 *
 * (order.total in tiyin; ids are strings, up to 64 characters.)
 */
export interface PaymentTarget {
  readonly type: string;
  /** Current amount, owner and whether it can be paid; null = not found. */
  resolve(id: string, manager?: EntityManager): Promise<PaymentTargetInfo | null>;
  onPaid(id: string, tx: PaymentTransaction, manager: EntityManager): Promise<void>;
  onCancelled(id: string, tx: PaymentTransaction, manager: EntityManager): Promise<void>;
}

/** Thrown by `PaymentTarget.onCancelled` (or WalletService) to keep a paid payment paid. */
export class PaymentCancelRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentCancelRefusedError';
  }
}

/** PaymentTarget implementations by type. Register them in `onModuleInit`. */
@Injectable()
export class PaymentTargetRegistry {
  private readonly targets = new Map<string, PaymentTarget>();

  register(target: PaymentTarget): void {
    const current = this.targets.get(target.type);
    if (current && current !== target) throw new Error(`Payment target "${target.type}" is registered twice`);
    this.targets.set(target.type, target);
  }

  get(type: string): PaymentTarget | undefined {
    return this.targets.get(type);
  }

  has(type: string): boolean {
    return this.targets.has(type);
  }

  types(): string[] {
    return [...this.targets.keys()];
  }
}
