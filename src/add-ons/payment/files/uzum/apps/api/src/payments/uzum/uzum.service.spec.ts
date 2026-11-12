import { ConfigService } from '@nestjs/config';
import { PaymentInvoice, PaymentStatus } from '@app/database';
import { PaymentProviderRegistry } from '../payment-provider';
import { FakePayments } from '../testing/fake-payments';
import { UzumErrorCode } from './uzum.errors';
import { UzumOperation, UzumReply, UzumService, UzumState } from './uzum.service';

const LOGIN = 'uzum-login';
const PASSWORD = 'uzum-password';
const SERVICE_ID = 498;
const auth = (login = LOGIN, password = PASSWORD) => `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;

function setup(env: Record<string, string> = {}) {
  const fake = new FakePayments();
  const registry = new PaymentProviderRegistry();
  const config = new ConfigService({ UZUM_SERVICE_ID: String(SERVICE_ID), UZUM_LOGIN: LOGIN, UZUM_PASSWORD: PASSWORD, ...env });
  const service = new UzumService(fake.asService(), registry, config);
  service.onModuleInit();
  const call = (operation: UzumOperation, body: Record<string, unknown>, authorization = auth(), ip = '127.0.0.1'): Promise<UzumReply> =>
    service.handle(operation, { serviceId: SERVICE_ID, timestamp: Date.now(), ...body }, authorization, ip);
  return { fake, registry, service, call };
}

const failed = (reply: UzumReply) => (reply.httpStatus === 400 ? reply.body.errorCode : undefined);

describe('UzumService', () => {
  it('registers itself and is configured only with service id, login and password', () => {
    const { registry, service } = setup();
    expect(registry.get('uzum')).toBe(service);
    expect(service.isConfigured()).toBe(true);
    expect(setup({ UZUM_PASSWORD: '' }).service.isConfigured()).toBe(false);
  });

  it('builds the pay URL from UZUM_PAY_URL, empty without it', () => {
    const invoice = Object.assign(new PaymentInvoice(), { number: '1000000003', amount: 1_250_050 });
    expect(setup().service.payUrl(invoice)).toBe('');
    expect(setup({ UZUM_PAY_URL: 'https://pay.example/{account}?a={amount}&s={sum}' }).service.payUrl(invoice)).toBe(
      'https://pay.example/1000000003?a=1250050&s=12500.50',
    );
  });

  describe('auth', () => {
    it('refuses a wrong password, a wrong login and no header with 10001 (HTTP 400)', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      const params = { params: { account: invoice.number } };
      for (const header of [auth(LOGIN, 'wrong'), auth('other', PASSWORD), '', 'Bearer x']) {
        const reply = await call('check', params, header);
        expect(reply.httpStatus).toBe(400);
        expect(reply.body.status).toBe('FAILED');
        expect(failed(reply)).toBe(UzumErrorCode.ACCESS_DENIED);
      }
    });

    it('refuses everything when not configured, and outside UZUM_ALLOWED_IPS', async () => {
      const off = setup({ UZUM_PASSWORD: '' });
      expect(failed(await off.call('check', { params: { account: '1' } }, auth(LOGIN, '')))).toBe(UzumErrorCode.ACCESS_DENIED);
      const { fake, call } = setup({ UZUM_ALLOWED_IPS: '10.0.0.0/8' });
      const invoice = fake.addInvoice('u1', 500_000);
      expect(failed(await call('check', { params: { account: invoice.number } }, auth(), '192.168.1.1'))).toBe(UzumErrorCode.ACCESS_DENIED);
      expect((await call('check', { params: { account: invoice.number } }, auth(), '::ffff:10.1.2.3')).httpStatus).toBe(200);
    });

    it('refuses another serviceId with 10006 and missing params with 10005', async () => {
      const { service } = setup();
      const reply = await service.handle('check', { serviceId: 1, params: { account: '1' } }, auth(), '127.0.0.1');
      expect(failed(reply)).toBe(UzumErrorCode.INVALID_SERVICE_ID);
      expect(failed(await service.handle('create', { serviceId: SERVICE_ID, params: {} }, auth(), '127.0.0.1'))).toBe(UzumErrorCode.MISSING_PARAMS);
    });
  });

  describe('flow', () => {
    it('check → create → confirm → reverse credits once and reverses the credit', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      const params = { account: invoice.number };

      const check = await call('check', { params });
      expect(check.httpStatus).toBe(200);
      expect(check.body).toEqual(expect.objectContaining({ serviceId: SERVICE_ID, status: 'OK', data: { account: { value: invoice.number } } }));

      const create = await call('create', { transId: 't-1', params, amount: 500_000 });
      expect(create.body.status).toBe('CREATED');
      expect(create.body.transId).toBe('t-1');
      expect((await call('create', { transId: 't-1', params, amount: 500_000 })).body.status).toBe('CREATED');
      expect(fake.transactions.length).toBe(1);

      const confirm = await call('confirm', { transId: 't-1' });
      expect(confirm.body.status).toBe('CONFIRMED');
      const again = await call('confirm', { transId: 't-1' });
      expect(again.body).toEqual(expect.objectContaining({ status: 'CONFIRMED', confirmTime: confirm.body.confirmTime }));
      expect(fake.balance('u1')).toBe(500_000);
      expect(fake.transactions[0].state).toBe(UzumState.CONFIRMED);

      expect((await call('status', { transId: 't-1' })).body.status).toBe('CONFIRMED');
      const reverse = await call('reverse', { transId: 't-1' });
      expect(reverse.body).toEqual(expect.objectContaining({ status: 'REVERSED', amount: 500_000 }));
      expect((await call('reverse', { transId: 't-1' })).body.reverseTime).toBe(reverse.body.reverseTime);
      expect(fake.balance('u1')).toBe(0);
      expect(fake.transactions[0].state).toBe(UzumState.REVERSED_AFTER_CONFIRM);
      expect((await call('status', { transId: 't-1' })).body.status).toBe('REVERSED');
      expect(failed(await call('confirm', { transId: 't-1' }))).toBe(UzumErrorCode.CANCELLED);
    });

    it('concurrent confirms credit once', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      await call('create', { transId: 't-2', params: { account: invoice.number }, amount: 500_000 });
      const replies = await Promise.all(Array.from({ length: 5 }, () => call('confirm', { transId: 't-2' })));
      expect(replies.every((r) => r.body.status === 'CONFIRMED')).toBe(true);
      expect(fake.balance('u1')).toBe(500_000);
    });

    it('reverses a created transaction (state -1) and refuses to confirm it later', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      await call('create', { transId: 't-3', params: { account: invoice.number }, amount: 500_000 });
      expect((await call('reverse', { transId: 't-3' })).body.status).toBe('REVERSED');
      expect(fake.transactions[0].state).toBe(UzumState.REVERSED);
      expect(failed(await call('confirm', { transId: 't-3' }))).toBe(UzumErrorCode.CANCELLED);
      expect(fake.balance('u1')).toBe(0);
    });

    it('refuses a reverse of a spent top-up (99999) and keeps it confirmed', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      await call('create', { transId: 't-4', params: { account: invoice.number }, amount: 500_000 });
      await call('confirm', { transId: 't-4' });
      fake.balances.set('u1', 100);
      expect(failed(await call('reverse', { transId: 't-4' }))).toBe(UzumErrorCode.DATA_CHECK_ERROR);
      expect(fake.transactions[0].status).toBe(PaymentStatus.PAID);
    });

    it('validates amounts in tiyin and accounts', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      const params = { account: invoice.number };
      for (const amount of [400_000, 500_000.5, -500_000, '500000']) {
        expect(failed(await call('create', { transId: `bad-${String(amount)}`, params, amount }))).toBe(UzumErrorCode.DATA_CHECK_ERROR);
      }
      expect(failed(await call('check', { params: { account: '1999999999' } }))).toBe(UzumErrorCode.NOT_FOUND);
      expect(failed(await call('status', { transId: 'nope' }))).toBe(UzumErrorCode.NOT_FOUND);
      // The same transId with another amount is not a repeat.
      await call('create', { transId: 't-5', params, amount: 500_000 });
      const other = fake.addInvoice('u1', 600_000);
      expect(failed(await call('create', { transId: 't-5', params: { account: other.number }, amount: 600_000 }))).toBe(
        UzumErrorCode.DATA_CHECK_ERROR,
      );
      expect(fake.transactions.length).toBe(1);
    });

    it('refuses a paid invoice with 10007', async () => {
      const { fake, call } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      await call('create', { transId: 't-6', params: { account: invoice.number }, amount: 500_000 });
      await call('confirm', { transId: 't-6' });
      expect(failed(await call('check', { params: { account: invoice.number } }))).toBe(UzumErrorCode.ALREADY_PAID);
      expect(failed(await call('create', { transId: 't-7', params: { account: invoice.number }, amount: 500_000 }))).toBe(
        UzumErrorCode.ALREADY_PAID,
      );
    });
  });

  it('tops up a wallet by user account number', async () => {
    const { fake, call } = setup();
    const userId = fake.addUser('100200');
    expect((await call('check', { params: { account: '100200' } })).httpStatus).toBe(200);
    await call('create', { transId: 't-8', params: { account: '100200' }, amount: 250_000 });
    await call('confirm', { transId: 't-8' });
    expect(fake.balance(userId)).toBe(250_000);
  });
});

