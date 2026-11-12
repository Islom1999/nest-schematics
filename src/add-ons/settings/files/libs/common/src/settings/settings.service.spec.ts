import { BadRequestException, ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { AppSetting } from '@app/database';
import { MemoryCacheStore } from '../cache/memory-cache-store';
import { isMaintenanceExempt, MaintenanceGuard, SKIP_MAINTENANCE_KEY } from './maintenance.guard';
import { SettingsService } from './settings.service';

/** In-memory stand-in for Repository<AppSetting> (only what SettingsService uses). */
function fakeRepository(rows: Partial<AppSetting>[] = []) {
  const data = rows.map((r) => ({ isPublic: false, description: null, value: null, ...r }) as AppSetting);
  const repo = {
    reads: 0,
    findOne: jest.fn(({ where }: { where: { key: string } }) => {
      repo.reads++;
      return Promise.resolve(data.find((r) => r.key === where.key) ?? null);
    }),
    find: jest.fn(() => Promise.resolve(data.filter((r) => r.isPublic).sort((a, b) => a.key.localeCompare(b.key)))),
    create: jest.fn((partial: Partial<AppSetting>) => ({ description: null, value: null, ...partial }) as AppSetting),
    save: jest.fn((row: AppSetting) => {
      if (!data.includes(row)) data.push(row);
      return Promise.resolve(row);
    }),
  };
  return repo;
}

function setup(rows: Partial<AppSetting>[] = []) {
  const repo = fakeRepository(rows);
  const service = new SettingsService(repo as unknown as Repository<AppSetting>, new MemoryCacheStore());
  return { repo, service };
}

describe('SettingsService', () => {
  it('reads through a short cache, including misses', async () => {
    const { repo, service } = setup([{ key: 'flags', value: { beta: true } }]);
    expect(await service.get('flags')).toEqual({ beta: true });
    expect(await service.get('flags')).toEqual({ beta: true });
    expect(await service.get('missing', 'fallback')).toBe('fallback');
    expect(await service.get('missing')).toBeUndefined();
    expect(repo.reads).toBe(2);
  });

  it('set() creates, replaces and invalidates the cached value and the public map', async () => {
    const { service } = setup([{ key: 'support_phone', value: '+1', isPublic: true }]);
    expect(await service.getPublic()).toEqual({ support_phone: '+1' });
    expect(await service.get('support_phone')).toBe('+1');

    await service.set('support_phone', '+2');
    await service.set('flags', { beta: false }, { isPublic: true, description: 'Feature flags' });
    expect(await service.get('support_phone')).toBe('+2');
    expect(await service.getPublic()).toEqual({ flags: { beta: false }, support_phone: '+2' });

    // value undefined keeps the stored value
    const row = await service.set('flags', undefined, { isPublic: false });
    expect(row.value).toEqual({ beta: false });
    expect(await service.getPublic()).toEqual({ support_phone: '+2' });
  });

  it('checks keys and the maintenance shape', async () => {
    const { service } = setup();
    await expect(service.set('bad key', 1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.set('maintenance', { enabled: 'yes' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.set('maintenance', { enabled: true, extra: 1 })).rejects.toBeInstanceOf(BadRequestException);
    await service.set('maintenance', { enabled: true, message: 'Soon' });
    expect(await service.maintenance()).toEqual({ enabled: true, message: 'Soon' });
  });

  it('treats a missing or malformed maintenance row as off', async () => {
    expect(await setup().service.maintenance()).toEqual({ enabled: false, message: '' });
    expect(await setup([{ key: 'maintenance', value: 'on' }]).service.maintenance()).toEqual({ enabled: false, message: '' });
  });
});

describe('MaintenanceGuard', () => {
  /** A route as Nest describes it: controller class + handler function, each with its path metadata. */
  function route(controllerPath: string, handlerPath: string, skip = false): ExecutionContext {
    class Controller {}
    const handler = () => undefined;
    Reflect.defineMetadata(PATH_METADATA, controllerPath, Controller);
    Reflect.defineMetadata(PATH_METADATA, handlerPath, handler);
    if (skip) Reflect.defineMetadata(SKIP_MAINTENANCE_KEY, true, handler);
    return { getType: () => 'http', getClass: () => Controller, getHandler: () => handler } as unknown as ExecutionContext;
  }

  it('answers 503 with the message on client routes only', async () => {
    const { service } = setup([{ key: 'maintenance', value: { enabled: true, message: 'Back at 10:00' } }]);
    const guard = new MaintenanceGuard(service, new Reflector());
    const error = await guard.canActivate(route('client/auth', 'me')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({ message: 'Back at 10:00', code: 'MAINTENANCE' });
    await expect(guard.canActivate(route('admin/settings', '/'))).resolves.toBe(true);
    await expect(guard.canActivate(route('settings', 'public'))).resolves.toBe(true);
    await expect(guard.canActivate(route('shop', 'ping', true))).resolves.toBe(true);
  });

  it('lets everything through when off, and fails open when settings cannot be read', async () => {
    const { service } = setup([{ key: 'maintenance', value: { enabled: false, message: '' } }]);
    await expect(new MaintenanceGuard(service, new Reflector()).canActivate(route('client/auth', 'me'))).resolves.toBe(true);

    const broken = { maintenance: () => Promise.reject(new Error('db down')) } as unknown as SettingsService;
    await expect(new MaintenanceGuard(broken, new Reflector()).canActivate(route('client/auth', 'me'))).resolves.toBe(true);
  });

  it('matches exempt prefixes on segment boundaries', () => {
    expect(isMaintenanceExempt('admin/settings')).toBe(true);
    expect(isMaintenanceExempt('auth/sign-in')).toBe(true);
    expect(isMaintenanceExempt('health/ready')).toBe(true);
    expect(isMaintenanceExempt('settings/public')).toBe(true);
    expect(isMaintenanceExempt('administrators')).toBe(false);
    expect(isMaintenanceExempt('client/auth/me')).toBe(false);
    expect(isMaintenanceExempt('settings')).toBe(false);
  });
});
