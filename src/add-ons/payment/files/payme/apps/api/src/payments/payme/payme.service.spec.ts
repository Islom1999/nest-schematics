import { ConfigService } from '@nestjs/config';
import { PaymentInvoice, PaymentStatus } from '@app/database';
import { PaymentProviderRegistry } from '../payment-provider';
import { FakePayments } from '../testing/fake-payments';
import { PaymeErrorCode } from './payme.errors';
import { PAYME_TIMEOUT_MS, PaymeResponse, PaymeService, PaymeState } from './payme.service';

const KEY = 'live-key';
const TEST_KEY = 'test-key';
const auth = (key = KEY, login = 'Paycom') => `Basic ${Buffer.from(`${login}:${key}`).toString('base64')}`;

function setup(env: Record<string, string> = {}) {
  const fake = new FakePayments();
  const registry = new PaymentProviderRegistry();
  const config = new ConfigService({ PAYME_MERCHANT_ID: 'merchant-1', PAYME_KEY: KEY, ...env });
  const service = new PaymeService(fake.asService(), registry, config);
  service.onModuleInit();
  let rpcId = 0;
  const call = (method: string, params: Record<string, unknown>, authorization = auth()): Promise<PaymeResponse> =>
    service.handle({ jsonrpc: '2.0', id: ++rpcId, method, params }, authorization, '127.0.0.1');
  return { fake, registry, service, call };
}

const errorCode = (response: PaymeResponse) => response.error?.code;
const result = (response: PaymeResponse) => response.result as Record<string, unknown>;

describe('PaymeService', () => {
  afterEach(() => jest.useRealTimers());

  it('registers itself and is configured only with a merchant id and a key', () => {
    const { registry, service } = setup();
    expect(registry.get('payme')).toBe(service);
    expect(service.isConfigured()).toBe(true);
    expect(setup({ PAYME_KEY: '' }).service.isConfigured()).toBe(false);
  });

  it('builds the checkout URL (base64 of m;ac.<field>;a)', () => {
    const { service } = setup({ PAYME_ACCOUNT_FIELD: 'invoice' });
    const url = service.payUrl(Object.assign(new PaymentInvoice(), { number: '1000000005', amount: 150_000 }));
    const [base, encoded] = url.split(/\/(?=[^/]+$)/);
    expect(base).toBe('https://checkout.paycom.uz');
    expect(Buffer.from(encoded, 'base64').toString()).toBe('m=merchant-1;ac.invoice=1000000005;a=150000');
  });

  describe('authorization', () => {
    it('refuses a wrong key, a wrong login and no header with -32504, echoing the request id', async () => {
      const { call } = setup();
      for (const header of [auth('wrong'), auth(KEY, 'Other'), '']) {
        const response = await call('CheckPerformTransaction', {}, header);
        expect(errorCode(response)).toBe(PaymeErrorCode.INSUFFICIENT_PRIVILEGE);
        expect(response.error?.message).toEqual(expect.objectContaining({ ru: expect.any(String), uz: expect.any(String), en: expect.any(String) }));
      }
      const response = await call('CheckPerformTransaction', {}, auth('wrong'));
      expect(response.id).toBe(4);
    });

    it('accepts PAYME_TEST_KEY only in test mode', async () => {
      const off = setup({ PAYME_TEST_KEY: TEST_KEY });
      expect(errorCode(await off.call('GetStatement', { from: 0, to: 1 }, auth(TEST_KEY)))).toBe(PaymeErrorCode.INSUFFICIENT_PRIVILEGE);
      const on = setup({ PAYME_TEST_KEY: TEST_KEY, PAYME_TEST_MODE: 'true' });
      expect(result(await on.call('GetStatement', { from: 0, to: 1 }, auth(TEST_KEY)))).toEqual({ transactions: [] });
    });

    it('refuses everything when the provider is not configured', async () => {
      const { call } = setup({ PAYME_KEY: '' });
      expect(errorCode(await call('GetStatement', { from: 0, to: 1 }, auth('')))).toBe(PaymeErrorCode.INSUFFICIENT_PRIVILEGE);
    });

    it('checks PAYME_ALLOWED_IPS', async () => {
      const { service } = setup({ PAYME_ALLOWED_IPS: '185.234.113.0/24' });
      const body = { id: 1, method: 'GetStatement', params: { from: 0, to: 1 } };
      expect((await service.handle(body, auth(), '10.0.0.1')).error?.code).toBe(PaymeErrorCode.INSUFFICIENT_PRIVILEGE);
      expect((await service.handle(body, auth(), '::ffff:185.234.113.15')).result).toEqual({ transactions: [] });
    });
  });

  it('answers ChangePassword and unknown methods with -32601, bad requests with -32600', async () => {
    const { call, service } = setup();
    expect(errorCode(await call('ChangePassword', { password: 'x' }))).toBe(PaymeErrorCode.METHOD_NOT_FOUND);
    expect(errorCode(await call('Nope', {}))).toBe(PaymeErrorCode.METHOD_NOT_FOUND);
    expect((await service.handle('garbage', auth(), '127.0.0.1')).error?.code).toBe(PaymeErrorCode.INVALID_REQUEST);
    expect(errorCode(await call('CreateTransaction', { id: 'x', amount: 1 }))).toBe(PaymeErrorCode.INVALID_REQUEST);
  });

  describe('state machine (invoice)', () => {
    it('create → perform → cancel after perform reverses the wallet credit', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      const params = { amount: 500_000, account: { account: invoice.number } };

      expect(result(await call('CheckPerformTransaction', params))).toEqual({ allow: true });

      const created = result(await call('CreateTransaction', { ...params, id: 'p-1', time: Date.now() }));
      expect(created).toEqual({ create_time: expect.any(Number), transaction: '1', state: PaymeState.CREATED });

      const performed = result(await call('PerformTransaction', { id: 'p-1' }));
      expect(performed).toEqual({ transaction: '1', perform_time: expect.any(Number), state: PaymeState.PERFORMED });
      expect(fake.balance('u1')).toBe(500_000);
      expect(fake.invoices[0].status).toBe('paid');

      const checked = result(await call('CheckTransaction', { id: 'p-1' }));
      expect(checked).toEqual(expect.objectContaining({ state: 2, reason: null, cancel_time: 0, transaction: '1' }));

      const cancelled = result(await call('CancelTransaction', { id: 'p-1', reason: 5 }));
      expect(cancelled).toEqual({ transaction: '1', cancel_time: expect.any(Number), state: PaymeState.CANCELLED_AFTER_PERFORM });
      expect(fake.balance('u1')).toBe(0);
      expect(fake.transactions[0]).toEqual(expect.objectContaining({ status: PaymentStatus.CANCELLED, reason: 5 }));
    });

    it('refuses a cancel after perform with -31007 when the top-up is spent', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      await call('CreateTransaction', { id: 'p-1', time: Date.now(), amount: 500_000, account: { account: invoice.number } });
      await call('PerformTransaction', { id: 'p-1' });
      fake.balances.set('u1', 100_000); // spent

      expect(errorCode(await call('CancelTransaction', { id: 'p-1', reason: 5 }))).toBe(PaymeErrorCode.CANNOT_CANCEL);
      expect(fake.transactions[0]).toEqual(expect.objectContaining({ status: PaymentStatus.PAID, state: PaymeState.PERFORMED }));
      expect(fake.balance('u1')).toBe(100_000);
    });

    it('cancels a created transaction with state -1 and refuses to perform it later', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      await call('CreateTransaction', { id: 'p-1', time: Date.now(), amount: 500_000, account: { account: invoice.number } });
      const cancelled = result(await call('CancelTransaction', { id: 'p-1', reason: 3 }));
      expect(cancelled.state).toBe(PaymeState.CANCELLED);
      expect(errorCode(await call('PerformTransaction', { id: 'p-1' }))).toBe(PaymeErrorCode.CANNOT_PERFORM);
      expect(errorCode(await call('CreateTransaction', { id: 'p-1', time: Date.now(), amount: 500_000, account: { account: invoice.number } }))).toBe(
        PaymeErrorCode.CANNOT_PERFORM,
      );
      expect(fake.balance('u1')).toBe(0);
    });

    it('answers repeated calls with the same result and never pays twice', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      const create = { id: 'p-1', time: Date.now(), amount: 500_000, account: { account: invoice.number } };
      const first = result(await call('CreateTransaction', create));
      expect(result(await call('CreateTransaction', create))).toEqual(first);
      const performed = result(await call('PerformTransaction', { id: 'p-1' }));
      expect(result(await call('PerformTransaction', { id: 'p-1' }))).toEqual(performed);
      expect(fake.balance('u1')).toBe(500_000);
      const cancelled = result(await call('CancelTransaction', { id: 'p-1', reason: 5 }));
      expect(result(await call('CancelTransaction', { id: 'p-1', reason: 5 }))).toEqual(cancelled);
      expect(fake.balance('u1')).toBe(0);
      expect(fake.transactions).toHaveLength(1);
    });

    it('stores the RPC id of each request, never reusing one', async () => {
      const { fake, service } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      const params = { id: 'p-1', time: Date.now(), amount: 500_000, account: { account: invoice.number } };
      const a = await service.handle({ id: 11, method: 'CreateTransaction', params }, auth(), '127.0.0.1');
      const b = await service.handle({ id: 12, method: 'PerformTransaction', params: { id: 'p-1' } }, auth(), '127.0.0.1');
      expect([a.id, b.id]).toEqual([11, 12]);
      expect(fake.transactions[0].raw).toEqual(
        expect.objectContaining({ create: expect.objectContaining({ rpcId: 11 }), perform: expect.objectContaining({ rpcId: 12 }) }),
      );
    });

    it('refuses a wrong amount with -31001 and an unknown account with -31050', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      expect(errorCode(await call('CheckPerformTransaction', { amount: 400_000, account: { account: invoice.number } }))).toBe(
        PaymeErrorCode.WRONG_AMOUNT,
      );
      expect(errorCode(await call('CreateTransaction', { id: 'p-1', time: Date.now(), amount: 400_000, account: { account: invoice.number } }))).toBe(
        PaymeErrorCode.WRONG_AMOUNT,
      );
      const unknown = await call('CheckPerformTransaction', { amount: 500_000, account: { account: '1999999999' } });
      expect(unknown.error).toEqual(expect.objectContaining({ code: PaymeErrorCode.ACCOUNT_NOT_FOUND, data: 'account' }));
      expect(errorCode(await call('CheckPerformTransaction', { amount: 500_000, account: {} }))).toBe(PaymeErrorCode.ACCOUNT_NOT_FOUND);
      expect(errorCode(await call('PerformTransaction', { id: 'missing' }))).toBe(PaymeErrorCode.TRANSACTION_NOT_FOUND);
    });

    it('refuses a paid invoice (-31051) and a second live transaction for one invoice (-31052)', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      const account = { account: invoice.number };
      await call('CreateTransaction', { id: 'p-1', time: Date.now(), amount: 500_000, account });
      expect(errorCode(await call('CheckPerformTransaction', { amount: 500_000, account }))).toBe(PaymeErrorCode.ACCOUNT_BUSY);
      expect(errorCode(await call('CreateTransaction', { id: 'p-2', time: Date.now(), amount: 500_000, account }))).toBe(PaymeErrorCode.ACCOUNT_BUSY);
      await call('PerformTransaction', { id: 'p-1' });
      expect(errorCode(await call('CheckPerformTransaction', { amount: 500_000, account }))).toBe(PaymeErrorCode.ACCOUNT_NOT_PAYABLE);
    });
  });

  describe('timeout (12 hours)', () => {
    it('refuses CreateTransaction whose Payme time is older than 12 hours', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      const old = Date.now() - PAYME_TIMEOUT_MS - 1000;
      expect(errorCode(await call('CreateTransaction', { id: 'p-1', time: old, amount: 500_000, account: { account: invoice.number } }))).toBe(
        PaymeErrorCode.CANNOT_PERFORM,
      );
      expect(fake.transactions).toHaveLength(0);
    });

    it('cancels an expired created transaction (state -1, reason 4) on perform', async () => {
      jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000, { expiresAt: new Date('2026-02-01T00:00:00Z') });
      await call('CreateTransaction', { id: 'p-1', time: Date.now(), amount: 500_000, account: { account: invoice.number } });

      jest.setSystemTime(new Date(Date.now() + PAYME_TIMEOUT_MS + 60_000));
      expect(errorCode(await call('PerformTransaction', { id: 'p-1' }))).toBe(PaymeErrorCode.CANNOT_PERFORM);
      expect(result(await call('CheckTransaction', { id: 'p-1' }))).toEqual(expect.objectContaining({ state: PaymeState.CANCELLED, reason: 4 }));
      expect(fake.balance('u1')).toBe(0);

      // An expired transaction no longer blocks the invoice.
      const next = result(await call('CreateTransaction', { id: 'p-2', time: Date.now(), amount: 500_000, account: { account: invoice.number } }));
      expect(next.state).toBe(PaymeState.CREATED);
    });
  });

  it('tops up a wallet by user account number and lists it in GetStatement', async () => {
    const { fake, call } = setup();
    const userId = fake.addUser('100042');
    const time = Date.now();
    await call('CreateTransaction', { id: 'p-1', time, amount: 200_000, account: { account: '100042' } });
    await call('PerformTransaction', { id: 'p-1' });
    expect(fake.balance(userId)).toBe(200_000);
    expect(errorCode(await call('CheckPerformTransaction', { amount: 1, account: { account: '100042' } }))).toBe(PaymeErrorCode.WRONG_AMOUNT);

    const statement = result(await call('GetStatement', { from: time - 1000, to: time + 1000 }));
    expect(statement.transactions).toEqual([
      expect.objectContaining({ id: 'p-1', time, amount: 200_000, account: { account: '100042' }, state: 2, transaction: '1' }),
    ]);
    expect(result(await call('GetStatement', { from: time + 1000, to: time + 2000 }))).toEqual({ transactions: [] });
  });
});
