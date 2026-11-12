import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from '@app/database';
import { CACHE_STORE, CacheStore } from '../cache/cache-store';
import {
  assertSettingKey,
  MAINTENANCE_SETTING,
  MaintenanceSetting,
  parseMaintenance,
  validateSettingValue,
} from './settings.types';

/** How long a read is trusted before the database is asked again. */
export const SETTINGS_CACHE_MS = 10_000;

/** Cache keys (`:` cannot appear in a setting key, so they never collide). */
const CACHE_PREFIX = 'settings:';
const PUBLIC_CACHE_KEY = `${CACHE_PREFIX}public`;
const keyOf = (key: string) => `${CACHE_PREFIX}key:${key}`;

interface CachedSetting {
  found: boolean;
  value: unknown;
}

export interface SetSettingOptions {
  description?: string | null;
  isPublic?: boolean;
}

/**
 * Runtime settings from `app_settings` with a short cache (CACHE_STORE: in
 * memory, or Redis with the redis add-on so every instance sees a change at
 * once). Misses are cached too. Writes through this service (and the admin
 * routes) invalidate the cache; direct SQL changes show up within
 * SETTINGS_CACHE_MS.
 *
 *   const flags = await settings.get<{ beta: boolean }>('flags', { beta: false });
 *   await settings.set('flags', { beta: true }, { isPublic: true });
 */
@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(AppSetting) private readonly repository: Repository<AppSetting>,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
  ) {}

  /** Value of `key`; `fallback` when the row is missing or its value is null. */
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T>(key: string, fallback: T): Promise<T>;
  async get<T>(key: string, fallback?: T): Promise<T | undefined> {
    let entry = await this.cache.get<CachedSetting>(keyOf(key));
    if (!entry) {
      const row = await this.repository.findOne({ where: { key } });
      entry = row ? { found: true, value: row.value } : { found: false, value: null };
      await this.cache.set(keyOf(key), entry, SETTINGS_CACHE_MS);
    }
    return entry.found && entry.value !== null && entry.value !== undefined ? (entry.value as T) : fallback;
  }

  /**
   * Creates or replaces `key`; `value: undefined` keeps the stored value (null
   * for a new key). Built-in keys are shape-checked (400 when wrong).
   */
  async set(key: string, value: unknown, options: SetSettingOptions = {}): Promise<AppSetting> {
    assertSettingKey(key);
    const row = (await this.repository.findOne({ where: { key } })) ?? this.repository.create({ key, isPublic: false });
    const next = value === undefined ? (row.value ?? null) : value;
    validateSettingValue(key, next);
    row.value = next;
    if (options.description !== undefined) row.description = options.description;
    if (options.isPublic !== undefined) row.isPublic = options.isPublic;
    const saved = await this.repository.save(row);
    await this.invalidate(key);
    return saved;
  }

  /** `{ key: value }` of every `isPublic` row (served at GET /api/settings/public). */
  async getPublic(): Promise<Record<string, unknown>> {
    const cached = await this.cache.get<Record<string, unknown>>(PUBLIC_CACHE_KEY);
    if (cached) return cached;
    const rows = await this.repository.find({ where: { isPublic: true }, order: { key: 'ASC' } });
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    await this.cache.set(PUBLIC_CACHE_KEY, values, SETTINGS_CACHE_MS);
    return values;
  }

  /** The maintenance switch (off when the row is missing or malformed). */
  async maintenance(): Promise<MaintenanceSetting> {
    return parseMaintenance(await this.get(MAINTENANCE_SETTING));
  }

  /** Drops cached values: one key (and the public map), or everything. */
  async invalidate(key?: string): Promise<void> {
    if (key === undefined) return this.cache.deleteByPrefix(CACHE_PREFIX);
    await this.cache.delete(keyOf(key), PUBLIC_CACHE_KEY);
  }
}
