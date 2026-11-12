import { BadGatewayException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheStore } from '@app/common';
import { PaymentStatus } from '@app/database';
import { PaymentProviderRegistry } from '../payment-provider';
import { FakePayments } from '../testing/fake-payments';
import { inpayTiyin, InpayService, InpayState } from './inpay.service';

/** A tiny in-memory CacheStore (get / set / delete are all InpayService uses). */
function memoryCache(): CacheStore {
  const values = new Map<string, unknown>();
  return {
    shared: false,
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async (key: string, value: unknown) => void values.set(key, value),
    delete: async (...keys: string[]) => keys.forEach((k) => values.delete(k)),
  } as unknown as CacheStore;
}

/** A fake inPAY API: orders by id, call counters, and switches for failures. */
class FakeInpay {
  orders = new Map<string, { status: string; amount: number | string }>();
  authCalls = 0;
  token = 'token-1';
  /** Answer the next authorized call with 401 (an expired token). */
  expireToken = false;
  down = false;
  private seq = 0;

  fetch: typeof fetch = async (input, init) => {
    if (this.down) throw new Error('connect ECONNREFUSED');
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname.endsWith('/authorization/')) {
      this.authCalls++;
      if (url.searchParams.get('merchant_token') !== 'merchant-token') return json(401, { success: false });
      return json(200, { success: true, bearer_token: this.token });
    }
    const authorization = new Headers(init?.headers).get('authorization');
    if (this.expireToken || authorization !== `Bearer ${this.token}`) {
      this.expireToken = false;
      return json(401, { success: false });
    }
    if (url.pathname.endsWith('/create/')) {
      const body = JSON.parse(init?.body as string) as { amount: number };
      const id = `ord-${++this.seq}`;
      this.orders.set(id, { status: 'pending', amount: body.amount });
      return json(200, { success: true, order_id: id, pay_url: `https://inpay.example/pay/${id}` });
    }
    if (url.pathname.endsWith('/transactions/')) {
      const id = url.searchParams.get('order_id') ?? '';
      const order = this.orders.get(id);
      if (!order) return json(404, { success: false });
      return json(200, { success: true, data: { order_id: id, ...order } });
    }
    return json(404, {});
  };
}

function setup(env: Record<string, string> = {}) {
  const fake = new FakePayments();
  const api = new FakeInpay();
  const registry = new PaymentProviderRegistry();
  const config = new ConfigService({ INPAY_MERCHANT_ID: 'merchant-1', INPAY_MERCHANT_TOKEN: 'merchant-token', ...env });
  const service = new InpayService(fake.asService(), registry, config, memoryCache());
  service.http = api.fetch;
  service.onModuleInit();
  return { fake, api, registry, service };
}

const IP = '127.0.0.1';

describe('InpayService', () => {
  it('registers itself and is configured only with a merchant id and token', () => {
    const { registry, service } = setup();
    expect(registry.get('inpay')).toBe(service);
    expect(service.isConfigured()).toBe(true);
    expect(setup({ INPAY_MERCHANT_TOKEN: '' }).service.isConfigured()).toBe(false);
  });

  it('converts inPAY sums to tiyin', () => {
    expect(inpayTiyin('5000.50')).toBe(500_050);
    expect(inpayTiyin(5000)).toBe(500_000);
    expect(inpayTiyin('5000.505')).toBeNull();
    expect(inpayTiyin('-1')).toBeNull();
    expect(inpayTiyin(undefined)).toBeNull();
  });

  describe('checkout (createTopUp)', () => {
    it('creates the order, stores a pending payment and caches the token', async () => {
      const { fake, api, service } = setup();
      const first = fake.addInvoice('u1', 500_000);
      expect(await service.payUrl(first)).toBe('https://inpay.example/pay/ord-1');
      expect(fake.transactions[0]).toEqual(
        expect.objectContaining({ provider: 'inpay', externalId: 'ord-1', amount: 500_000, status: PaymentStatus.PENDING, state: InpayState.PENDING }),
      );
      expect(api.orders.get('ord-1')?.amount).toBe(5000);
      await service.payUrl(fake.addInvoice('u1', 600_000));
      expect(api.authCalls).toBe(1);
    });

    it('shares one authorization between concurrent checkouts and refreshes the token once on 401', async () => {
      const { fake, api, service } = setup();
      await Promise.all([service.payUrl(fake.addInvoice('u1', 500_000)), service.payUrl(fake.addInvoice('u1', 500_000))]);
      expect(api.authCalls).toBe(1);
      api.token = 'token-2';
      await service.payUrl(fake.addInvoice('u1', 500_000));
      expect(api.authCalls).toBe(2);
      expect(fake.transactions.length).toBe(3);
    });

    it('answers 502 when inPAY is down and stores nothing', async () => {
      const { fake, api, service } = setup();
      api.down = true;
      await expect(service.payUrl(fake.addInvoice('u1', 500_000))).rejects.toBeInstanceOf(BadGatewayException);
      expect(fake.transactions.length).toBe(0);
    });
  });

  describe('webhook', () => {
    async function paidSetup() {
      const ctx = setup();
      await ctx.service.payUrl(ctx.fake.addInvoice('u1', 500_000));
      return ctx;
    }

    it('never trusts the body: a "success" body for a pending order changes nothing', async () => {
      const { fake, service } = await paidSetup();
      expect(await service.handleWebhook({ order_id: 'ord-1', status: 'success', amount: '5000' }, IP)).toEqual({ success: true });
      expect(fake.transactions[0].status).toBe(PaymentStatus.PENDING);
      expect(fake.balance('u1')).toBe(0);
    });

    it('credits once when the API says success, also for repeated and concurrent webhooks', async () => {
      const { fake, api, service } = await paidSetup();
      api.orders.get('ord-1')!.status = 'success';
      await Promise.all(Array.from({ length: 5 }, () => service.handleWebhook({ order_id: 'ord-1' }, IP)));
      await service.handleWebhook({ order_id: 'ord-1' }, IP);
      expect(fake.balance('u1')).toBe(500_000);
      expect(fake.transactions[0]).toEqual(expect.objectContaining({ status: PaymentStatus.PAID, state: InpayState.PAID }));
    });

    it('leaves the payment pending when the API amount differs', async () => {
      const { fake, api, service } = await paidSetup();
      Object.assign(api.orders.get('ord-1')!, { status: 'success', amount: '4999.99' });
      await service.handleWebhook({ order_id: 'ord-1' }, IP);
      expect(fake.transactions[0].status).toBe(PaymentStatus.PENDING);
      expect(fake.balance('u1')).toBe(0);
    });

    it('marks failed and cancelled orders', async () => {
      const { fake, api, service } = await paidSetup();
      await service.payUrl(fake.addInvoice('u1', 500_000));
      api.orders.get('ord-1')!.status = 'failed';
      api.orders.get('ord-2')!.status = 'cancelled';
      await service.handleWebhook({ order_id: 'ord-1' }, IP);
      await service.handleWebhook({ order_id: 'ord-2' }, IP);
      expect(fake.transactions.map((t) => t.status)).toEqual([PaymentStatus.FAILED, PaymentStatus.CANCELLED]);
      // A late "success" does not revive them.
      api.orders.get('ord-1')!.status = 'success';
      await service.handleWebhook({ order_id: 'ord-1' }, IP);
      expect(fake.balance('u1')).toBe(0);
    });

    it('acknowledges unknown orders, refuses bad bodies, other IPs and an unconfigured provider', async () => {
      const { fake, service } = await paidSetup();
      expect(await service.handleWebhook({ order_id: 'ord-404' }, IP)).toEqual({ success: true });
      await expect(service.handleWebhook({ order_id: '../x' }, IP)).rejects.toThrow('order_id');
      await expect(setup({ INPAY_ALLOWED_IPS: '10.0.0.1' }).service.handleWebhook({ order_id: 'ord-1' }, IP)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(setup({ INPAY_MERCHANT_ID: '' }).service.handleWebhook({ order_id: 'ord-1' }, IP)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(fake.transactions[0].status).toBe(PaymentStatus.PENDING);
    });

    it('answers 502 when the API is down, so inPAY retries', async () => {
      const { api, service } = await paidSetup();
      api.down = true;
      await expect(service.handleWebhook({ order_id: 'ord-1' }, IP)).rejects.toBeInstanceOf(BadGatewayException);
    });
  });
});
