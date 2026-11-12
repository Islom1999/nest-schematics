import { Repository, SelectQueryBuilder } from 'typeorm';
import { runTableQuery } from '@app/common';
import { PaymentInvoice, PaymentTransaction } from '@app/database';
import { PaymentProviderRegistry } from '../payment-provider';
import { PaymentsService } from '../payments.service';
import { AdminPaymentsService } from './admin-payments.service';

jest.mock('@app/common', () => ({
  ...jest.requireActual<Record<string, unknown>>('@app/common'),
  runTableQuery: jest.fn(),
}));

describe('AdminPaymentsService.exportCsv', () => {
  it('orders by id after the requested sort, so rows with the same createdAt keep one order across chunks', async () => {
    const calls: string[] = [];
    const sorted = jest.mocked(runTableQuery);
    sorted.mockImplementation(() => {
      calls.push('requested sort');
      return Promise.resolve({ count: 1, data: [] });
    });

    const qb = {
      select: () => qb,
      andWhere: () => qb,
      skip: () => qb,
      take: () => qb,
      addOrderBy: (sort: string, direction?: string) => {
        calls.push(`${sort} ${direction ?? ''}`.trim());
        return qb;
      },
      getMany: () => Promise.resolve([]),
    };
    const repository = { createQueryBuilder: () => qb } as unknown as Repository<PaymentTransaction>;
    const service = new AdminPaymentsService(
      repository,
      {} as Repository<PaymentInvoice>,
      {} as PaymentsService,
      {} as PaymentProviderRegistry,
    );

    const { stream } = await service.exportCsv({ sortField: 'createdAt', sortOrder: -1 });
    await stream.toArray();

    expect(sorted).toHaveBeenCalledWith(qb as unknown as SelectQueryBuilder<PaymentTransaction>, expect.objectContaining({ sortField: 'createdAt' }), expect.anything());
    expect(calls).toEqual(['requested sort', 'payment.id ASC']);
  });
});
