import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { User } from '@app/database';
import { ClientAuthService } from '../client-auth.service';
import { UserSessionsService } from '../user-sessions.service';
import { UsersService } from './users.service';

/** The body fields (phone, email, password) depend on the installed sign-in methods: build it loosely. */
const body = <T>(fields: Record<string, unknown>) => fields as T;

const COLUMNS = new Set(['name', 'phone', 'email', 'passwordHash', 'accountNo']);

/** In-memory stand-in for Repository<User>: only what UsersService (and BaseCrudService) call. */
function setup(rows: Partial<User>[] = []) {
  const data = rows.map((r, i) => ({ id: `id-${i + 1}`, isBlocked: false, deletedAt: null, ...r }) as User);
  const qb = {
    calls: [] as [string, unknown[]][],
    where: undefined as { id?: string } | undefined,
  };
  const chain = new Proxy(qb, {
    get(target, prop: string) {
      if (prop === 'then') return undefined;
      if (prop === 'getOne') return () => Promise.resolve(data.find((r) => r.id === target.where?.id) ?? null);
      if (prop === 'getMany') return () => Promise.resolve(data);
      if (prop in target) return (target as never)[prop];
      return (...args: unknown[]) => {
        target.calls.push([prop, args]);
        if (prop === 'andWhere' && typeof args[1] === 'object') target.where = args[1] as { id?: string };
        return chain;
      };
    },
  });
  const repo = {
    metadata: { findColumnWithPropertyName: (name: string) => (COLUMNS.has(name) ? { propertyName: name } : undefined) },
    exists: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      const { id, ...rest } = where;
      const excluded = (id as { value?: string } | undefined)?.value;
      return Promise.resolve(data.some((r) => r.id !== excluded && Object.entries(rest).every(([k, v]) => (r as never)[k] === v)));
    }),
    createQueryBuilder: jest.fn(() => chain),
    findOne: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(data.find((r) => r.id === where.id) ?? null)),
    create: jest.fn((partial: Partial<User>) => ({ id: `id-${data.length + 1}`, isBlocked: false, ...partial }) as User),
    save: jest.fn((row: User) => {
      if (!data.includes(row)) data.push(row);
      return Promise.resolve(row);
    }),
    softDelete: jest.fn(() => Promise.resolve()),
    update: jest.fn(() => Promise.resolve()),
  };
  const sessions = { revokeAll: jest.fn(() => Promise.resolve(2)) };
  const auth = { invalidateUser: jest.fn(() => Promise.resolve()) };
  const service = new UsersService(
    repo as unknown as Repository<User>,
    sessions as unknown as UserSessionsService,
    auth as unknown as ClientAuthService,
  );
  return { repo, qb, data, sessions, auth, service };
}

describe('UsersService (admin)', () => {
  it('creates a user and hashes the password with argon2 only when one is sent', async () => {
    const { repo, service } = setup();
    await service.create(body({ name: 'Ali', password: 'secret-123' }));
    const saved = repo.create.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(saved['password']).toBeUndefined();
    expect(saved['passwordHash']).toMatch(/^\$argon2id\$/);

    await service.create({ name: 'Vali' });
    const plain = repo.create.mock.calls[1][0] as unknown as Record<string, unknown>;
    expect('passwordHash' in plain).toBe(false);
  });

  it('answers 409 for a taken phone or email, on create and on edit of another user', async () => {
    const { service } = setup([{ phone: '+998901234567' }, { email: 'a@b.uz' }]);
    await expect(service.create(body({ phone: '+998901234567' }))).rejects.toThrow(/phone already exists/);
    await expect(service.create(body({ email: 'a@b.uz' }))).rejects.toThrow(/email already exists/);
    await expect(service.update('id-2', body({ phone: '+998901234567' }))).rejects.toThrow(ConflictException);
  });

  it('maps a database unique violation (race) to 409', async () => {
    const { repo, service } = setup();
    repo.save.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));
    await expect(service.create({ name: 'X' })).rejects.toThrow(ConflictException);
  });

  it('blocking through edit ends all sessions; a plain edit does not', async () => {
    const { sessions, auth, service } = setup([{ name: 'Ali' }]);
    await service.update('id-1', { name: 'Ali V' });
    expect(sessions.revokeAll).not.toHaveBeenCalled();
    await service.update('id-1', { isBlocked: true });
    expect(sessions.revokeAll).toHaveBeenCalledWith('id-1', 'blocked');
    expect(auth.invalidateUser).toHaveBeenCalledWith('id-1');
  });

  it('delete is a soft delete and revokes every session', async () => {
    const { repo, sessions, auth, service } = setup([{ name: 'Ali' }]);
    expect(await service.delete('id-1')).toEqual({ deleted: true, id: 'id-1' });
    expect(repo.softDelete).toHaveBeenCalledWith('id-1');
    expect(sessions.revokeAll).toHaveBeenCalledWith('id-1', 'deleted');
    expect(auth.invalidateUser).toHaveBeenCalledWith('id-1');
    await expect(service.delete('missing')).rejects.toThrow(NotFoundException);
  });

  it('list() caps the limit at 1000 and searches the search fields', async () => {
    const { qb, service } = setup([{ name: 'Ali' }]);
    await service.list('50%', 99999);
    const calls = Object.fromEntries(qb.calls.map(([name, args]) => [name, args]));
    expect(calls['take']).toEqual([1000]);
    const [sql, params] = calls['andWhere'] as [string, { term: string }];
    expect(sql).toContain('ILIKE :term');
    expect(params.term).toBe('%50\\%%');
    await service.list(undefined, 0);
    expect(qb.calls.filter(([name]) => name === 'take').pop()![1]).toEqual([1]);
  });
});
