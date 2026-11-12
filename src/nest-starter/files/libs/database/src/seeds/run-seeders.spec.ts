import { DataSource } from 'typeorm';
import { runSeeders } from './run-seeders';
import { Seeder } from './seeder';

describe('runSeeders', () => {
  const dataSource = {} as DataSource;
  let calls: string[];
  const seeder = (name: string, devOnly = false): Seeder => ({
    name,
    devOnly,
    run: async () => {
      calls.push(name);
    },
  });
  const seeders = [seeder('roles'), seeder('demo', true), seeder('settings')];

  beforeEach(() => {
    calls = [];
  });

  it('runs every seeder in registry order', async () => {
    await expect(runSeeders(dataSource, seeders)).resolves.toEqual(['roles', 'demo', 'settings']);
    expect(calls).toEqual(['roles', 'demo', 'settings']);
  });

  it('runs only the named seeders', async () => {
    await runSeeders(dataSource, seeders, { only: ['settings', 'roles'] });
    expect(calls).toEqual(['roles', 'settings']);
  });

  it('skips devOnly seeders in production', async () => {
    await runSeeders(dataSource, seeders, { production: true });
    expect(calls).toEqual(['roles', 'settings']);
  });

  it('fails on an unknown name before running anything', async () => {
    await expect(runSeeders(dataSource, seeders, { only: ['roles', 'nope'] })).rejects.toThrow(
      /Unknown seeder\(s\): nope/,
    );
    expect(calls).toEqual([]);
  });
});
