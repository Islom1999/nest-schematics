import { ConfigService } from '@nestjs/config';
import { PaymentInvoice, PaymentStatus } from '@app/database';
import { PaymentProviderRegistry } from '../payment-provider';
import { FakePayments } from '../testing/fake-payments';
import { PaynetErrorCode } from './paynet.errors';
import { formatPaynetTime, parsePaynetTime, PaynetResponse, PaynetService, PaynetState } from './paynet.service';

const LOGIN = 'paynet-login';
const PASSWORD = 'paynet-password';
const auth = (login = LOGIN, password = PASSWORD) => `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;

function setup(env: Record<string, string> = {}) {
  const fake = new FakePayments();
  const registry = new PaymentProviderRegistry();
  const config = new ConfigService({ PAYNET_LOGIN: LOGIN, PAYNET_PASSWORD: PASSWORD, ...env });
  const service = new PaynetService(fake.asService(), registry, config);
  service.onModuleInit();
  let rpcId = 0;
  const call = (method: string, params: Record<string, unknown>, authorization = auth(), ip = '127.0.0.1'): Promise<PaynetResponse> =>
    service.handle({ jsonrpc: '2.0', id: ++rpcId, method, params }, authorization, ip);
  return { fake, registry, service, call };
}

const errorCode = (response: PaynetResponse) => response.error?.code;
const result = (response: PaynetResponse) => response.result as Record<string, unknown>;
const now = () => formatPaynetTime(new Date());

describe('PaynetService', () => {
  it('registers itself and is configured only with a login and a password', () => {
    const { registry, service } = setup();
    expect(registry.get('paynet')).toBe(service);
    expect(service.isConfigured()).toBe(true);
    expect(setup({ PAYNET_PASSWORD: '' }).service.isConfigured()).toBe(false);
    expect(service.payUrl(Object.assign(new PaymentInvoice(), { number: '1000000001', amount: 100_000 }))).toBe('');
  });

  it('formats and parses Tashkent times', () => {
    expect(formatPaynetTime(new Date('2026-03-01T19:30:05Z'))).toBe('2026-03-02 00:30:05');
    expect(parsePaynetTime('2026-03-02 00:30:05')?.toISOString()).toBe('2026-03-01T19:30:05.000Z');
    expect(parsePaynetTime('2026-02-31 10:00:00')).toBeNull();
    expect(parsePaynetTime('yesterday')).toBeNull();
  });

  describe('auth', () => {
    it('refuses wrong credentials with 412, echoing the request id', async () => {
      const { call } = setup();
      for (const header of [auth(LOGIN, 'wrong'), auth('other', PASSWORD), '']) {
        const response = await call('GetInformation', { fields: { account: '1' } }, header);
        expect(errorCode(response)).toBe(PaynetErrorCode.WRONG_LOGIN);
        expect(typeof response.id).toBe('number');
      }
    });

    it('answers 601 when not configured, outside PAYNET_ALLOWED_IPS or for another serviceId', async () => {
      expect(errorCode(await setup({ PAYNET_LOGIN: '' }).call('GetInformation', {}, auth('', PASSWORD)))).toBe(PaynetErrorCode.ACCESS_DENIED);
      const { call } = setup({ PAYNET_ALLOWED_IPS: '10.0.0.1', PAYNET_SERVICE_ID: '77' });
      expect(errorCode(await call('GetInformation', { serviceId: 77 }, auth(), '10.0.0.2'))).toBe(PaynetErrorCode.ACCESS_DENIED);
      expect(errorCode(await call('GetInformation', { serviceId: 78, fields: { account: '1' } }, auth(), '10.0.0.1'))).toBe(
        PaynetErrorCode.ACCESS_DENIED,
      );
    });

    it('answers unknown methods with -32601 and bad requests with -32600', async () => {
      const { service, call } = setup();
      expect(errorCode(await call('ChangePassword', {}))).toBe(PaynetErrorCode.METHOD_NOT_FOUND);
      expect(errorCode(await service.handle('nope', auth(), '127.0.0.1'))).toBe(PaynetErrorCode.INVALID_REQUEST);
    });
  });

  describe('transactions', () => {
    it('GetInformation → Perform → Check → Cancel credits once and reverses it', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      const fields = { account: invoice.number };

      expect(result(await call('GetInformation', { fields }))).toEqual(expect.objectContaining({ status: '0', fields }));
      const perform = await call('PerformTransaction', { transactionId: 9001, amount: 500_000, fields, timestamp: now() });
      expect(result(perform).providerTrnId).toBe(1);
      expect(fake.balance('u1')).toBe(500_000);

      // A repeated transactionId changes nothing.
      expect(errorCode(await call('PerformTransaction', { transactionId: 9001, amount: 500_000, fields, timestamp: now() }))).toBe(
        PaynetErrorCode.TRANSACTION_EXISTS,
      );
      expect(fake.balance('u1')).toBe(500_000);
      expect(fake.transactions.length).toBe(1);

      expect(result(await call('CheckTransaction', { transactionId: 9001 }))).toEqual(
        expect.objectContaining({ transactionState: PaynetState.SUCCESS, providerTrnId: 1 }),
      );
      expect(result(await call('CancelTransaction', { transactionId: 9001 }))).toEqual(
        expect.objectContaining({ transactionState: PaynetState.CANCELLED, providerTrnId: 1 }),
      );
      expect(fake.balance('u1')).toBe(0);
      expect(errorCode(await call('CancelTransaction', { transactionId: 9001 }))).toBe(PaynetErrorCode.TRANSACTION_CANCELLED);
      expect(result(await call('CheckTransaction', { transactionId: 9001 })).transactionState).toBe(PaynetState.CANCELLED);
      expect(fake.balance('u1')).toBe(0);
    });

    it('refuses a cancel of a spent top-up with 77', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      await call('PerformTransaction', { transactionId: 1, amount: 500_000, fields: { account: invoice.number } });
      fake.balances.set('u1', 10);
      expect(errorCode(await call('CancelTransaction', { transactionId: 1 }))).toBe(PaynetErrorCode.INSUFFICIENT_FUNDS_TO_CANCEL);
      expect(fake.transactions[0].status).toBe(PaymentStatus.PAID);
    });

    it('validates amounts in tiyin, accounts, ids and times', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      const fields = { account: invoice.number };
      for (const amount of [400_000, 500_000.5, 0, '500000']) {
        expect(errorCode(await call('PerformTransaction', { transactionId: 2, amount, fields }))).toBe(PaynetErrorCode.WRONG_AMOUNT);
      }
      expect(errorCode(await call('PerformTransaction', { transactionId: 2, amount: 500_000, fields: { account: '1999999999' } }))).toBe(
        PaynetErrorCode.CLIENT_NOT_FOUND,
      );
      expect(errorCode(await call('PerformTransaction', { amount: 500_000, fields }))).toBe(PaynetErrorCode.MISSING_PARAMS);
      expect(errorCode(await call('PerformTransaction', { transactionId: 2, amount: 500_000, fields, timestamp: '02.03.2026' }))).toBe(
        PaynetErrorCode.WRONG_DATETIME,
      );
      expect(errorCode(await call('CheckTransaction', { transactionId: 404 }))).toBe(PaynetErrorCode.TRANSACTION_NOT_FOUND);
      expect(fake.transactions.length).toBe(0);
      expect(fake.balance('u1')).toBe(0);
    });

    it('refuses a paid invoice and never pays it twice', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      await call('PerformTransaction', { transactionId: 3, amount: 500_000, fields: { account: invoice.number } });
      expect(errorCode(await call('PerformTransaction', { transactionId: 4, amount: 500_000, fields: { account: invoice.number } }))).toBe(
        PaynetErrorCode.CLIENT_NOT_FOUND,
      );
      expect(fake.balance('u1')).toBe(500_000);
    });

    it('tops up a wallet by account number and lists it in GetStatement', async () => {
      const { fake, call } = setup();
      const userId = fake.addUser('100300');
      const timestamp = now();
      await call('PerformTransaction', { transactionId: 5, amount: 300_000, fields: { account: '100300' }, timestamp });
      await call('PerformTransaction', { transactionId: 6, amount: 200_000, fields: { account: '100300' }, timestamp });
      await call('CancelTransaction', { transactionId: 6 });
      expect(fake.balance(userId)).toBe(300_000);
      const from = formatPaynetTime(new Date(Date.now() - 60_000));
      const to = formatPaynetTime(new Date(Date.now() + 60_000));
      expect(result(await call('GetStatement', { dateFrom: from, dateTo: to })).statements).toEqual([
        { amount: 300_000, providerTrnId: 1, transactionId: 5, timestamp },
      ]);
    });
  });
});
