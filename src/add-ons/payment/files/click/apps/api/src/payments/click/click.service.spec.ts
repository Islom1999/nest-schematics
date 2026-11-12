import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PaymentInvoice, PaymentStatus } from '@app/database';
import { PaymentProviderRegistry } from '../payment-provider';
import { FakePayments } from '../testing/fake-payments';
import { ClickErrorCode } from './click.errors';
import { ClickRequest, ClickService, ClickState } from './click.service';

const SECRET = 'click-secret';
const SERVICE_ID = '12345';

const md5 = (text: string) => createHash('md5').update(text).digest('hex');

function setup(env: Record<string, string> = {}) {
  const fake = new FakePayments();
  const registry = new PaymentProviderRegistry();
  const config = new ConfigService({ CLICK_SERVICE_ID: SERVICE_ID, CLICK_MERCHANT_ID: '777', CLICK_SECRET_KEY: SECRET, ...env });
  const service = new ClickService(fake.asService(), registry, config);
  service.onModuleInit();
  return { fake, registry, service };
}

/** A signed form like Click sends (all values are strings). */
function prepareForm(clickTransId: string, account: string, amount: string, patch: ClickRequest = {}): ClickRequest {
  const form: Record<string, string> = {
    click_trans_id: clickTransId,
    service_id: SERVICE_ID,
    click_paydoc_id: `doc-${clickTransId}`,
    merchant_trans_id: account,
    amount,
    action: '0',
    error: '0',
    error_note: 'Success',
    sign_time: '2026-01-01 10:00:00',
  };
  form.sign_string = md5(`${form.click_trans_id}${form.service_id}${SECRET}${form.merchant_trans_id}${form.amount}${form.action}${form.sign_time}`);
  return { ...form, ...patch };
}

function completeForm(clickTransId: string, account: string, amount: string, prepareId: number, patch: Record<string, string> = {}): ClickRequest {
  const form: Record<string, string> = {
    click_trans_id: clickTransId,
    service_id: SERVICE_ID,
    click_paydoc_id: `doc-${clickTransId}`,
    merchant_trans_id: account,
    merchant_prepare_id: String(prepareId),
    amount,
    action: '1',
    error: '0',
    error_note: 'Success',
    sign_time: '2026-01-01 10:00:05',
    ...patch,
  };
  form.sign_string = md5(
    `${form.click_trans_id}${form.service_id}${SECRET}${form.merchant_trans_id}${form.merchant_prepare_id}${form.amount}${form.action}${form.sign_time}`,
  );
  return form;
}

const IP = '127.0.0.1';

describe('ClickService', () => {
  it('registers itself; configured only with service id, merchant id and secret key', () => {
    const { registry, service } = setup();
    expect(registry.get('click')).toBe(service);
    expect(service.isConfigured()).toBe(true);
    expect(setup({ CLICK_SECRET_KEY: '' }).service.isConfigured()).toBe(false);
  });

  it('builds the pay URL with the amount in sum', () => {
    const { service } = setup({ CLICK_MERCHANT_USER_ID: '55' });
    const url = new URL(service.payUrl(Object.assign(new PaymentInvoice(), { number: '1000000007', amount: 1_250_050 })));
    expect(url.origin + url.pathname).toBe('https://my.click.uz/services/pay');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      service_id: SERVICE_ID,
      merchant_id: '777',
      amount: '12500.50',
      transaction_param: '1000000007',
      merchant_user_id: '55',
    });
  });

  describe('sign check', () => {
    it('refuses a bad sign, a missing secret and a disallowed IP with -1', async () => {
      const { fake, service } = setup({ CLICK_ALLOWED_IPS: '127.0.0.1' });
      const invoice = fake.addInvoice('u1', 500_000);
      const bad = await service.prepare(prepareForm('c-1', invoice.number, '5000', { sign_string: md5('nope') }), IP);
      expect(bad).toEqual(expect.objectContaining({ error: ClickErrorCode.SIGN_CHECK_FAILED, error_note: 'SIGN CHECK FAILED!' }));
      const tampered = await service.prepare({ ...prepareForm('c-1', invoice.number, '5000'), amount: '1' }, IP);
      expect(tampered.error).toBe(ClickErrorCode.SIGN_CHECK_FAILED);
      expect((await service.prepare(prepareForm('c-1', invoice.number, '5000'), '10.0.0.9')).error).toBe(ClickErrorCode.SIGN_CHECK_FAILED);
      const unconfigured = setup({ CLICK_SECRET_KEY: '' }).service;
      expect((await unconfigured.prepare(prepareForm('c-1', invoice.number, '5000'), IP)).error).toBe(ClickErrorCode.SIGN_CHECK_FAILED);
      expect(fake.transactions).toHaveLength(0);
    });

    it('answers -8 for missing fields or another service, -3 for a wrong action', async () => {
      const { fake, service } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      const { amount: _amount, ...missing } = prepareForm('c-1', invoice.number, '5000');
      expect((await service.prepare(missing, IP)).error).toBe(ClickErrorCode.BAD_REQUEST);
      expect((await service.complete(prepareForm('c-1', invoice.number, '5000'), IP)).error).toBe(ClickErrorCode.BAD_REQUEST);
      const wrongAction = completeForm('c-1', invoice.number, '5000', 1, { action: '0' });
      expect((await service.complete(wrongAction, IP)).error).toBe(ClickErrorCode.ACTION_NOT_FOUND);
    });
  });

  describe('prepare / complete', () => {
    it('pays an invoice once and credits the wallet', async () => {
      const { fake, service } = setup();
      const invoice = fake.addInvoice('u1', 500_000);

      const prepared = await service.prepare(prepareForm('c-1', invoice.number, '5000.00'), IP);
      expect(prepared).toEqual({
        click_trans_id: 'c-1',
        merchant_trans_id: invoice.number,
        merchant_prepare_id: 1,
        error: 0,
        error_note: 'Success',
      });
      expect(await service.prepare(prepareForm('c-1', invoice.number, '5000.00'), IP)).toEqual(prepared);
      expect(fake.transactions).toHaveLength(1);

      const completed = await service.complete(completeForm('c-1', invoice.number, '5000.00', 1), IP);
      expect(completed).toEqual(expect.objectContaining({ merchant_confirm_id: 1, error: 0 }));
      expect(fake.balance('u1')).toBe(500_000);
      expect(fake.transactions[0]).toEqual(expect.objectContaining({ status: PaymentStatus.PAID, state: ClickState.COMPLETED }));

      expect((await service.complete(completeForm('c-1', invoice.number, '5000.00', 1), IP)).error).toBe(ClickErrorCode.ALREADY_PAID);
      expect((await service.prepare(prepareForm('c-1', invoice.number, '5000.00'), IP)).error).toBe(ClickErrorCode.ALREADY_PAID);
      expect((await service.prepare(prepareForm('c-2', invoice.number, '5000.00'), IP)).error).toBe(ClickErrorCode.ALREADY_PAID);
      expect(fake.balance('u1')).toBe(500_000);
    });

    it('marks the payment failed when Click reports an error on complete (-9)', async () => {
      const { fake, service } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      await service.prepare(prepareForm('c-1', invoice.number, '5000'), IP);
      const failed = await service.complete(completeForm('c-1', invoice.number, '5000', 1, { error: '-5017', error_note: 'Insufficient funds' }), IP);
      expect(failed.error).toBe(ClickErrorCode.TRANSACTION_CANCELLED);
      expect(fake.transactions[0]).toEqual(expect.objectContaining({ status: PaymentStatus.FAILED, state: ClickState.CANCELLED, reason: -5017 }));
      expect((await service.complete(completeForm('c-1', invoice.number, '5000', 1), IP)).error).toBe(ClickErrorCode.TRANSACTION_CANCELLED);
      expect(fake.balance('u1')).toBe(0);
    });

    it('answers -2 for a wrong amount, -5 for an unknown account, -6 for an unknown transaction', async () => {
      const { fake, service } = setup();
      const invoice = fake.addInvoice('u1', 500_000);
      expect((await service.prepare(prepareForm('c-1', invoice.number, '4000'), IP)).error).toBe(ClickErrorCode.INCORRECT_AMOUNT);
      expect((await service.prepare(prepareForm('c-1', invoice.number, 'abc'), IP)).error).toBe(ClickErrorCode.INCORRECT_AMOUNT);
      expect((await service.prepare(prepareForm('c-1', '1999999999', '5000'), IP)).error).toBe(ClickErrorCode.USER_NOT_FOUND);
      expect((await service.complete(completeForm('c-404', invoice.number, '5000', 99), IP)).error).toBe(ClickErrorCode.TRANSACTION_NOT_FOUND);

      await service.prepare(prepareForm('c-1', invoice.number, '5000'), IP);
      expect((await service.complete(completeForm('c-1', invoice.number, '5000', 2), IP)).error).toBe(ClickErrorCode.TRANSACTION_NOT_FOUND);
      expect((await service.complete(completeForm('c-1', invoice.number, '4000', 1), IP)).error).toBe(ClickErrorCode.INCORRECT_AMOUNT);
      expect(fake.balance('u1')).toBe(0);
    });

    it('tops up a wallet by user account number', async () => {
      const { fake, service } = setup();
      const userId = fake.addUser('100042');
      const prepared = await service.prepare(prepareForm('c-9', '100042', '2000'), IP);
      expect(prepared.error).toBe(0);
      const completed = await service.complete(completeForm('c-9', '100042', '2000', prepared.merchant_prepare_id ?? 0), IP);
      expect(completed.error).toBe(0);
      expect(fake.balance(userId)).toBe(200_000);
    });
  });
});
