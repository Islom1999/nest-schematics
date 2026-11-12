import { TableQueryDto } from '@app/common';

/**
 * Body of `POST admin/settings/pagination[/archive]` (Angular `TableQueryDTO`).
 * Filterable/sortable fields: id, key, description, isPublic, createdAt, updatedAt.
 */
export class QuerySettingDto extends TableQueryDto {}
