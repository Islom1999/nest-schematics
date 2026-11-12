import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeepPartial, EntityTarget, FindOptionsWhere, In, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { OptionDto, OptionsQueryDto, PaginatedResult, TableQueryDto } from '../dto/table-query.dto';
import { escapeLike, runTableQuery, SECRET_FIELD, TableQueryOptions } from '../query/table-query';
import { BaseEntity } from '@app/database';

/** A DTO id field that points at rows of another entity (see `relationIds`). */
export interface RelationIds {
  /** Entity the ids reference. */
  target: EntityTarget<ObjectLiteral>;
  /**
   * ManyToMany relation property the ids are resolved into (`tagIds` → `tags`).
   * Omit for a ManyToOne id column (`categoryId`), which is only checked.
   */
  relation?: string;
  /** Conditions every referenced row must meet, e.g. `{ kind: 'image' }`. */
  where?: Record<string, unknown>;
}

/**
 * Generic admin CRUD over one entity: PrimeNG-compatible pagination and soft
 * delete (archive + restore). Customise through the protected hooks instead
 * of rewriting endpoints:
 *
 * - `alias` / `relations` / `extendQuery()` shape the list + detail query
 *   (joined relations are filterable/sortable as `category.name`);
 *   `detailRelations` are joined into the detail only (ManyToMany lists).
 * - `relationIds` — DTO id fields (`categoryId`, `tagIds`) checked against
 *   their target and, for ManyToMany, resolved to entities on create/update.
 * - `optionLabel` — label column of `GET options` (relation selects).
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
  /** Relations joined into the detail (`GET /:id`) only, e.g. ManyToMany lists. */
  protected detailRelations: string[] = [];
  /** DTO id fields → referenced entity: `{ categoryId: { target: Category }, tagIds: { target: Tag, relation: 'tags' } }`. */
  protected relationIds: Record<string, RelationIds> = {};
  /** Column shown as `label` by `GET options`; falls back to `id` when the entity has no such column. */
  protected optionLabel = 'name';
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

  protected createQuery(archived = false, detail = false): SelectQueryBuilder<M> {
    const qb = this.repository.createQueryBuilder(this.alias);
    for (const relation of detail ? [...this.relations, ...this.detailRelations] : this.relations) {
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
    return this.toDetail(this.withRelationIds(await this.getEntity(id, isActive)));
  }

  /** Entity with the list and detail joins; 404 when missing. */
  protected async getEntity(id: string, isActive = true): Promise<M> {
    const entity = await this.createQuery(!isActive, true).andWhere(`${this.alias}.id = :id`, { id }).getOne();
    if (!entity) throw new NotFoundException(this.notFoundMessage);
    return entity;
  }

  /** `GET /options` — `{ id, label }[]` for relation selects, sorted by label. */
  async options(query: OptionsQueryDto = {}): Promise<OptionDto[]> {
    const meta = this.repository.metadata;
    const requested = query.label ?? this.optionLabel;
    let column = meta.findColumnWithPropertyName(requested);
    if (!column && !query.label) column = meta.findColumnWithPropertyName('id');
    if (!column || column.relationMetadata || SECRET_FIELD.test(column.propertyName)) {
      throw new BadRequestException(`Unknown label field "${requested}"`);
    }
    const qb = this.repository.createQueryBuilder(this.alias);
    const label = `CAST(${qb.escape(this.alias)}.${qb.escape(column.databaseName)} AS TEXT)`;
    qb.select(`${qb.escape(this.alias)}.${qb.escape('id')}`, 'id').addSelect(label, 'label');
    const ids = query.ids ?? [];
    if (ids.length) qb.andWhere(`${this.alias}.id IN (:...ids)`, { ids });
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(`${label} ILIKE :search`, { search: `%${escapeLike(search)}%` });
    }
    return qb
      .orderBy(label, 'ASC')
      .addOrderBy(`${this.alias}.id`, 'ASC')
      .limit(Math.max(query.limit ?? 20, ids.length))
      .getRawMany<OptionDto>();
  }

  /** Bare entity (no joins); 404 when missing. */
  protected async getRaw(id: string, withDeleted = false): Promise<M> {
    const entity = await this.repository.findOne({ where: { id } as FindOptionsWhere<M>, withDeleted });
    if (!entity) throw new NotFoundException(this.notFoundMessage);
    return entity;
  }

  // ── Mutations ──────────────────────────────────────────────────────────

  async create(dto: C): Promise<unknown> {
    const data = await this.resolveRelationIds(await this.beforeCreate(dto));
    const saved = await this.repository.save(this.repository.create(data));
    return this.findOne(saved.id);
  }

  async update(id: string, dto: U): Promise<unknown> {
    const entity = await this.getRaw(id);
    const patch = await this.resolveRelationIds(await this.beforeUpdate(entity, dto));
    await this.repository.save(Object.assign(entity, patch));
    return this.findOne(id);
  }

  /**
   * Checks every `relationIds` field present in `data` (400 for unknown ids)
   * and turns ManyToMany id lists into entities (`tagIds` → `tags`; null or
   * `[]` clears the list).
   */
  protected async resolveRelationIds(data: DeepPartial<M>): Promise<DeepPartial<M>> {
    const out = { ...data } as Record<string, unknown>;
    for (const [key, ref] of Object.entries(this.relationIds)) {
      // DTO classes define absent properties as undefined: "not sent", leave as is.
      const value = out[key];
      if (value === undefined) continue;
      const ids = [...new Set((Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string'))];
      const rows = ids.length
        ? await this.repository.manager
            .getRepository(ref.target)
            .find({ where: { ...ref.where, id: In(ids) } as FindOptionsWhere<ObjectLiteral> })
        : [];
      if (rows.length !== ids.length) {
        const found = new Set(rows.map((r) => r.id as string));
        throw new BadRequestException(`${key}: not found: ${ids.filter((i) => !found.has(i)).join(', ')}`);
      }
      if (ref.relation) {
        delete out[key];
        out[ref.relation] = rows;
      }
    }
    return out as DeepPartial<M>;
  }

  /** Adds the id lists of loaded ManyToMany relations (`tags` → `tagIds`), for edit forms. */
  protected withRelationIds(entity: M): M {
    for (const [key, ref] of Object.entries(this.relationIds)) {
      const rows = ref.relation ? (entity as Record<string, unknown>)[ref.relation] : undefined;
      if (Array.isArray(rows)) Object.assign(entity, { [key]: rows.map((r: { id: string }) => r.id) });
    }
    return entity;
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
