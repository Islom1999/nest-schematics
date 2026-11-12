import { Logger } from '@nestjs/common';
import { SearchProviderBase } from './search-provider.base';
import { SearchService } from './search.service';
import { escapeLike, SEARCH_RESULT_LIMIT, SearchHit } from './search.types';

class FakeProvider extends SearchProviderBase {
  readonly calls: { query: string; limit: number }[] = [];
  readonly label: string;

  constructor(
    search: SearchService,
    readonly id: string,
    readonly permissions: readonly string[],
    private readonly hits: number | Error,
  ) {
    super(search);
    this.label = id.toUpperCase();
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    this.calls.push({ query, limit });
    if (this.hits instanceof Error) throw this.hits;
    return Array.from({ length: this.hits }, (_, i) => ({ id: `${this.id}-${i}`, link: `/${this.id}/${i}`, value: query }));
  }
}

function setup() {
  const service = new SearchService();
  const admins = new FakeProvider(service, 'admins', ['admin.read'], 2);
  const roles = new FakeProvider(service, 'roles', ['role.read'], 20);
  const open = new FakeProvider(service, 'help', [], 1);
  [admins, roles, open].forEach((p) => p.onModuleInit());
  return { service, admins, roles, open };
}

describe('SearchService', () => {
  it('searches only the providers the admin has the permissions for', async () => {
    const { service, admins, roles } = setup();
    const sets = await service.search(['admin.read'], 'john');
    expect(sets.map((s) => s.id)).toEqual(['admins', 'help']);
    expect(admins.calls).toHaveLength(1);
    expect(roles.calls).toHaveLength(0);
    expect(sets[0]).toMatchObject({ label: 'ADMINS', results: [{ id: 'admins-0' }, { id: 'admins-1' }] });
  });

  it('gives an admin without any permission only the open providers', async () => {
    const { service } = setup();
    expect((await service.search([], 'john')).map((s) => s.id)).toEqual(['help']);
  });

  it('searches everything for the super admin and caps each group', async () => {
    const { service, roles } = setup();
    const sets = await service.search(['*'], '  john  ');
    expect(sets.map((s) => s.id)).toEqual(['admins', 'roles', 'help']);
    expect(sets[1].results).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(roles.calls[0]).toEqual({ query: 'john', limit: SEARCH_RESULT_LIMIT });
  });

  it('answers nothing for a query shorter than 2 characters', async () => {
    const { service, admins } = setup();
    expect(await service.search(['*'], ' a ')).toEqual([]);
    expect(admins.calls).toHaveLength(0);
  });

  it('cuts a very long query', async () => {
    const { service, admins } = setup();
    await service.search(['*'], 'x'.repeat(500));
    expect(admins.calls[0].query).toHaveLength(100);
  });

  it('skips a failing provider and drops empty groups', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const service = new SearchService();
      new FakeProvider(service, 'broken', [], new Error('boom')).onModuleInit();
      new FakeProvider(service, 'empty', [], 0).onModuleInit();
      new FakeProvider(service, 'fine', [], 1).onModuleInit();
      expect((await service.search([], 'john')).map((s) => s.id)).toEqual(['fine']);
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });

  it('refuses a provider id registered twice', () => {
    const service = new SearchService();
    new FakeProvider(service, 'admins', [], 1).onModuleInit();
    expect(() => new FakeProvider(service, 'admins', [], 1).onModuleInit()).toThrow(/registered twice/);
  });
});

describe('escapeLike', () => {
  it('matches %, _ and backslash literally', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(escapeLike('plain')).toBe('plain');
  });
});
