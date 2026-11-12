import { DataSource, EntityManager } from 'typeorm';
import { Wallet, WalletTransaction, WalletTransactionType } from '@app/database';
import { InsufficientFundsException, WalletService } from './wallet.service';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * A tiny in-memory database for WalletService: transactions commit or roll
 * back as a whole, and `lock: pessimistic_write` blocks other transactions on
 * the same wallet row until the holder ends (like SELECT ... FOR UPDATE).
 * Every read yields to the event loop so concurrent calls really interleave.
 * The e2e step checks the same thing against Postgres.
 */
class FakeDb {
  readonly wallets = new Map<string, { id: string; userId: string; balance: number }>();
  readonly ledger: WalletTransaction[] = [];
  private readonly locks = new Map<string, Promise<void>>();
  /** Set to false to see the race the lock prevents. */
  locking = true;

  dataSource(): DataSource {
    return { manager: this.manager(null) } as unknown as DataSource;
  }

  private manager(tx: { staged: (() => void)[]; release: (() => void)[] } | null): EntityManager {
    const manager = {
      queryRunner: tx ? { isTransactionActive: true } : undefined,
      transaction: async <T>(work: (m: EntityManager) => Promise<T>): Promise<T> => {
        const inner = { staged: [] as (() => void)[], release: [] as (() => void)[] };
        try {
          const result = await work(this.manager(inner));
          inner.staged.forEach((apply) => apply());
          return result;
        } finally {
          inner.release.forEach((release) => release());
        }
      },
      query: async (_sql: string, [userId]: [string]) => {
        await tick();
        if (!this.wallets.has(userId)) this.wallets.set(userId, { id: `w-${userId}`, userId, balance: 0 });
        return [];
      },
      findOne: async (_entity: unknown, options: { where: { userId: string }; lock?: unknown }) => {
        const { userId } = options.where;
        if (options.lock && tx && this.locking) {
          while (this.locks.has(userId)) await this.locks.get(userId);
          let release!: () => void;
          this.locks.set(userId, new Promise<void>((resolve) => (release = resolve)));
          tx.release.push(() => {
            this.locks.delete(userId);
            release();
          });
        }
        await tick();
        const row = this.wallets.get(userId);
        return row ? Object.assign(new Wallet(), { ...row }) : null;
      },
      update: async (_entity: unknown, where: { id: string }, patch: { balance: number }) => {
        await tick();
        const apply = () => {
          const row = [...this.wallets.values()].find((w) => w.id === where.id);
          if (row) row.balance = patch.balance;
        };
        if (tx) tx.staged.push(apply);
        else apply();
      },
      create: (_entity: unknown, data: Partial<WalletTransaction>) => Object.assign(new WalletTransaction(), data),
      save: async (entry: WalletTransaction) => {
        if (tx) tx.staged.push(() => this.ledger.push(entry));
        else this.ledger.push(entry);
        return entry;
      },
    };
    return manager as unknown as EntityManager;
  }
}

describe('WalletService', () => {
  it('credits and debits with a ledger row holding the balance after', async () => {
    const db = new FakeDb();
    const wallet = new WalletService(db.dataSource());
    await wallet.credit('u1', 1000);
    const debit = await wallet.debit('u1', 300, { reference: 'order:1' });
    expect(debit).toEqual(expect.objectContaining({ amount: -300, type: WalletTransactionType.PURCHASE, balanceAfter: 700, reference: 'order:1' }));
    expect(await wallet.balance('u1')).toBe(700);
    expect(db.ledger.map((e) => e.amount)).toEqual([1000, -300]);
  });

  it('never overdraws: InsufficientFundsException and nothing changes', async () => {
    const db = new FakeDb();
    const wallet = new WalletService(db.dataSource());
    await wallet.credit('u1', 100);
    await expect(wallet.debit('u1', 101)).rejects.toBeInstanceOf(InsufficientFundsException);
    expect(await wallet.balance('u1')).toBe(100);
    expect(db.ledger).toHaveLength(1);
  });

  it('rejects non-positive and fractional amounts', async () => {
    const wallet = new WalletService(new FakeDb().dataSource());
    await expect(wallet.credit('u1', 0)).rejects.toThrow('positive integer');
    await expect(wallet.debit('u1', 1.5)).rejects.toThrow('positive integer');
    await expect(wallet.adjust('u1', 0, 'x')).rejects.toThrow('non-zero');
  });

  it('applies concurrent debits one at a time under the row lock', async () => {
    const db = new FakeDb();
    const wallet = new WalletService(db.dataSource());
    await wallet.credit('u1', 1000);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => wallet.debit('u1', 300)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected').every((r) => r.reason instanceof InsufficientFundsException)).toBe(true);
    expect(await wallet.balance('u1')).toBe(100);
    expect(db.ledger.filter((e) => e.amount < 0)).toHaveLength(3);
  });

  it('loses updates without the lock (what the lock is for)', async () => {
    const db = new FakeDb();
    db.locking = false;
    const wallet = new WalletService(db.dataSource());
    await wallet.credit('u1', 1000);
    await Promise.allSettled(Array.from({ length: 10 }, () => wallet.debit('u1', 300)));
    expect(db.ledger.filter((e) => e.amount < 0).length).toBeGreaterThan(3);
  });

  it('joins a transaction the caller already runs', async () => {
    const db = new FakeDb();
    const wallet = new WalletService(db.dataSource());
    await expect(
      db.dataSource().manager.transaction(async (manager) => {
        await wallet.credit('u1', 500, {}, manager);
        throw new Error('the order failed');
      }),
    ).rejects.toThrow('the order failed');
    expect(await wallet.balance('u1')).toBe(0);
    expect(db.ledger).toHaveLength(0);
  });
});
