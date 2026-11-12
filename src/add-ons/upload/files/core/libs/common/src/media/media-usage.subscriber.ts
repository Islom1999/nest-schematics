import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  EntityMetadata,
  EntitySubscriberInterface,
  InsertEvent,
  ObjectLiteral,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { MediaFile } from '@app/database';
import { MediaFilesService } from './media-files.service';

type MediaRef =
  | { kind: 'one'; read: (entity: ObjectLiteral) => unknown }
  | { kind: 'many'; read: (entity: ObjectLiteral) => unknown };

function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
}

/** Ids a ref holds in `entity`; null when the entity does not carry that field (not loaded / not sent). */
function idsOf(ref: MediaRef, entity: ObjectLiteral | undefined): string[] | null {
  if (!entity) return null;
  const value = ref.read(entity);
  if (value === undefined) return null;
  if (ref.kind === 'many') {
    return Array.isArray(value) ? value.map(idOf).filter((id): id is string => !!id) : null;
  }
  const id = idOf(value);
  return id ? [id] : [];
}

/**
 * Keeps `media_files.used` in sync for every entity with a relation to
 * MediaFile (crud `image:file(image)` → ManyToOne, `docs:file(pdf)[]` →
 * ManyToMany), inside the same transaction as the save:
 * - insert: the referenced files become used by the new row;
 * - update: newly referenced files become used, files no longer referenced are released;
 * - hard remove: its files are released. Soft delete (archive) keeps them,
 *   so a restored record still has its files.
 * Owner = `{ type: <table name>, id: <row id> }`.
 */
@Injectable()
export class MediaUsageSubscriber implements EntitySubscriberInterface {
  private readonly refs = new Map<EntityMetadata, MediaRef[]>();

  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly media: MediaFilesService,
  ) {
    dataSource.subscribers.push(this);
  }

  async afterInsert(event: InsertEvent<ObjectLiteral>): Promise<void> {
    const refs = this.refsOf(event.metadata);
    if (!refs.length) return;
    const ids = refs.flatMap((ref) => idsOf(ref, event.entity) ?? []);
    await this.markUsed(event.manager, event.metadata, event.entity, ids);
  }

  async afterUpdate(event: UpdateEvent<ObjectLiteral>): Promise<void> {
    const refs = this.refsOf(event.metadata);
    if (!refs.length || !event.entity) return;
    const added: string[] = [];
    const removed: string[] = [];
    for (const ref of refs) {
      const next = idsOf(ref, event.entity);
      if (next === null) continue;
      const before = idsOf(ref, event.databaseEntity);
      added.push(...next.filter((id) => !before?.includes(id)));
      if (before) removed.push(...before.filter((id) => !next.includes(id)));
    }
    const owner = event.entity.id ? event.entity : event.databaseEntity;
    await this.markUsed(event.manager, event.metadata, owner, added);
    await this.media.release(removed, event.manager);
  }

  async afterRemove(event: RemoveEvent<ObjectLiteral>): Promise<void> {
    const refs = this.refsOf(event.metadata);
    if (!refs.length) return;
    const source = event.databaseEntity ?? event.entity;
    await this.media.release(refs.flatMap((ref) => idsOf(ref, source) ?? []), event.manager);
  }

  private async markUsed(
    manager: EntityManager,
    metadata: EntityMetadata,
    entity: ObjectLiteral | undefined,
    ids: string[],
  ): Promise<void> {
    const ownerId = idOf(entity?.id);
    if (!ids.length || !ownerId) return;
    await this.media.markUsed(ids, { type: metadata.tableName, id: ownerId }, manager);
  }

  /** Relations of `metadata` that point at MediaFile (cached). */
  private refsOf(metadata: EntityMetadata): MediaRef[] {
    let refs = this.refs.get(metadata);
    if (refs) return refs;
    refs = [];
    if (metadata.target !== MediaFile) {
      for (const relation of metadata.relations) {
        if (relation.inverseEntityMetadata.target !== MediaFile) continue;
        if ((relation.isManyToOne || relation.isOneToOneOwner) && relation.joinColumns.length === 1) {
          const column = relation.joinColumns[0];
          refs.push({ kind: 'one', read: (entity) => column.getEntityValue(entity) as unknown });
        } else if (relation.isManyToManyOwner) {
          refs.push({ kind: 'many', read: (entity) => relation.getEntityValue(entity) as unknown });
        }
      }
    }
    this.refs.set(metadata, refs);
    return refs;
  }
}
