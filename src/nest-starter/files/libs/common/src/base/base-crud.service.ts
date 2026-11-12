import { NotFoundException } from '@nestjs/common';
import { DeepPartial, FindOptionsWhere, Repository, SelectQueryBuilder } from 'typeorm';
import { PaginatedResult, TableQueryDto } from '../dto/table-query.dto';
import { runTableQuery, SECRET_FIELD, TableQueryOptions } from '../query/table-query';
import { BaseEntity } from '@app/database';

/**
 * Generic admin CRUD over one entity: PrimeNG-compatible pagination and soft
 * delete (archive + restore). Customise through the protected hooks instead
 * of rewriting endpoints:
 *
 * - `alias` / `relations` / `extendQuery()` shape the list + detail query
 *   (joined relations are filterable/sortable as `category.name`).
 * - `tableOptions` — global-search fields, custom filters, default sort.
 * - `toRow()` / `toDetail()` — map entities to the API response.
 * - `beforeCreate()` / `beforeUpdate()` / `beforeDelete()` / `beforeRestore()`
 *   — unique checks, "in use" guards, normalisation.
 */
export abstract class BaseCrudService<
  M extends BaseEntity,
  C extends object = DeepPartial<M>,
  U extends object = DeepPartial<M>,
> {
  /** Query-builder alias of the main entity. */
  protected alias = 'entity';
  /** Relations joined (`leftJoinAndSelect`) into list/detail, aliased by name. */
  protected relations: string[] = [];
  protected tableOptions: TableQueryOptions = {
    defaultSort: { field: 'createdAt', order: 'DESC' },
  };
  protected notFoundMessage = 'Record not found';

  protected constructor(protected readonly repository: Repository<M>) {}

  // ── Hooks ──────────────────────────────────────────────────────────────

  /** Extra joins / relation counts for list and detail queries. */
  protected extendQuery?(qb: SelectQueryBuilder<M>): void;

  /** Response shape of a list row. */
  protected toRow(entity: M): unknown {
    return entity;
  }

  /** Response shape of a single record (defaults to the row shape). */
  protected toDetail(entity: M): unknown {
    return this.toRow(entity);
  }

  protected beforeCreate(dto: C): Promise<DeepPartial<M>> | DeepPartial<M> {
    return dto as unknown as DeepPartial<M>;
  }

  protected beforeUpdate(_entity: M, dto: U): Promise<DeepPartial<M>> | DeepPartial<M> {
    return dto as unknown as DeepPartial<M>;
  }

  protected beforeDelete?(entity: M): Promise<void> | void;

  protected beforeRestore?(entity: M): Promise<void> | void;

  // ── Queries ────────────────────────────────────────────────────────────

  protected createQuery(archived = false): SelectQueryBuilder<M> {
    const qb = this.repository.createQueryBuilder(this.alias);
    for (const relation of this.relations) {
      qb.leftJoinAndSelect(`${this.alias}.${relation}`, relation);
    }
    this.extendQuery?.(qb);
    if (archived) {
      qb.withDeleted().andWhere(`${this.alias}.deletedAt IS NOT NULL`);
    }
    return qb;
  }

  /** `GET /` — unpaged list (dropdowns, small tables). Only `?column=value` filters. */
  async findAll(where: Record<string, string> = {}): Promise<unknown[]> {
    const qb = this.createQuery();
    const meta = this.repository.metadata;
    for (const [key, value] of Object.entries(where)) {
      const column = meta.findColumnWithPropertyName(key);
      if (!column || SECRET_FIELD.test(key) || value === undefined || value === '') continue;
      // Compared as text so a malformed id/enum is "no rows", not a 500.
      qb.andWhere(`CAST(${this.alias}.${column.propertyPath} AS TEXT) = :w_${key}`, { [`w_${key}`]: value });
    }
    const sort = this.tableOptions.defaultSort;
    if (sort) {
      const field = sort.field.includes('.') ? sort.field : `${this.alias}.${sort.field}`;
      qb.orderBy(field, sort.order);
    }
    const rows = await qb.getMany();
    return rows.map((row) => this.toRow(row));
  }

  /** `POST /pagination` (active) and `POST /pagination/archive` (soft-deleted). */
  async findAllPagination(query: TableQueryDto, isActive = true): Promise<PaginatedResult<unknown>> {
    const result = await runTableQuery(this.createQuery(!isActive), query, this.tableOptions);
    return { count: result.count, data: result.data.map((row) => this.toRow(row)) };
  }

  /** `GET /:id` (active) and `GET /archive/:id` (soft-deleted). */
  async findOne(id: string, isActive = true): Promise<unknown> {
    return this.toDetail(await this.getEntity(id, isActive));
  }

  /** Entity with the list joins; 404 when missing. */
  protected async getEntity(id: string, isActive = true): Promise<M> {
    const entity = await this.createQuery(!isActive).andWhere(`${this.alias}.id = :id`, { id }).getOne();
    if (!entity) throw new NotFoundException(this.notFoundMessage);
    return entity;
  }

  /** Bare entity (no joins); 404 when missing. */
  protected async getRaw(id: string, withDeleted = false): Promise<M> {
    const entity = await this.repository.findOne({ where: { id } as FindOptionsWhere<M>, withDeleted });
    if (!entity) throw new NotFoundException(this.notFoundMessage);
    return entity;
  }

  // ── Mutations ──────────────────────────────────────────────────────────

  async create(dto: C): Promise<unknown> {
    const data = await this.beforeCreate(dto);
    const saved = await this.repository.save(this.repository.create(data));
    return this.findOne(saved.id);
  }

  async update(id: string, dto: U): Promise<unknown> {
    const entity = await this.getRaw(id);
    const patch = await this.beforeUpdate(entity, dto);
    await this.repository.save(Object.assign(entity, patch));
    return this.findOne(id);
  }

  /** Soft delete: the row moves to the archive and can be restored. */
  async delete(id: string): Promise<{ deleted: boolean; id: string }> {
    const entity = await this.getRaw(id);
    await this.beforeDelete?.(entity);
    await this.repository.softDelete(id);
    return { deleted: true, id };
  }

  /** `GET /repair/:id` — restore from the archive. */
  async repair(id: string): Promise<unknown> {
    const entity = await this.getRaw(id, true);
    if (!entity.deletedAt) throw new NotFoundException(this.notFoundMessage);
    await this.beforeRestore?.(entity);
    await this.repository.restore(id);
    return this.findOne(id);
  }
}
