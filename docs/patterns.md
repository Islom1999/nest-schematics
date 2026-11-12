# Patterns and the frontend ↔ backend contract

The `fuse-nest-schematics` templates are drawn from three real NestJS backends and fitted to the API contract of the [fuse-schematics](../../fuse-schematics) Angular frontend.

| Short name | Path | Notes |
|---|---|---|
| **jobsy** | `~/Projects/Sturtub/mailcontrol/jobsy-backend` | Webpack monorepo (api + libs). Has the safest PrimeNG query engine and permission system. |
| **anisa** | `~/Projects/Sturtub/anisa_app/anisa-backend` | `BaseAdminController` with the same route set as the frontend (the origin of the contract), plus a worker/bot split. |
| **asroortv** | `~/Projects/Sturtub/BananaTV/asroortv_anime_api` | Monorepo (api/bot/cron). Has a TypeORM error filter. The frontend `IBaseModel` (snake_case) was copied from here. |

---

## 1. Where each pattern came from

### Monorepo structure

| Pattern | Source | Note |
|---|---|---|
| `nest-cli.json` with `monorepo: true`, `webpack: true`, `apps/*` + `libs/*` | jobsy | Webpack bundles `@app/*` path aliases straight into `dist/apps/<app>/main.js`, so no `tsconfig-paths` is needed at runtime. |
| `@app/common`, `@app/database` path aliases | jobsy | |
| api / bot / worker apps | anisa (worker, bot), asroortv (bot, cron) | `--apps api,bot,worker`. `api` is always included. |
| Bot on `telegraf ^4.16.3`, disabled when there is no `BOT_TOKEN` | all three | |
| Worker on `@nestjs/schedule` | anisa | Heartbeat example `@Cron(EVERY_HOUR)`. |
| Per-app `build:<app>`, `start:dev:<app>`, `start:prod:<app>` scripts | jobsy | |

### Database (`libs/database`)

| Pattern | Source | Note |
|---|---|---|
| `SnakeNamingStrategy` (no `typeorm-naming-strategies` dependency) | jobsy (copied) | Columns are snake_case in the DB, properties are camelCase in code. |
| `BaseEntity`: uuid `id`, `createdAt`/`updatedAt` timestamptz, `@Index() @DeleteDateColumn deletedAt` | jobsy (index on deletedAt), anisa (soft delete) | |
| `autoLoadEntities: true` + `TypeOrmModule.forFeature` | anisa | No entity list to maintain by hand. |
| `data-source.ts` + `migration:*` scripts (ts-node, `tsconfig-paths`) | jobsy / asroortv | |
| Entities in the shared lib (`libs/database/src/entities`) + barrel | jobsy | The bot and worker can use the same entities. |

### CRUD layer (`libs/common`)

| Pattern | Source | Note |
|---|---|---|
| Route set: `GET /`, `POST pagination`, `POST pagination/archive`, `GET :id`, `GET archive/:id`, `POST`, `PUT :id`, `DELETE :id`, `GET repair/:id` | anisa `BaseAdminController` | Matches the frontend `BaseCrudService` exactly. |
| `runTableQuery` (jobsy `runPrimeTableQuery`) | jobsy | Field whitelist from TypeORM metadata, hiding `select: false` columns (SECRET_FIELD), `escapeLike`, value coercion, `Brackets`, `operator: 'or'`. i18n was removed. |
| Lenient coercion: `contains` on a number or boolean becomes `equals`, and `"true"`/`"1"` strings are converted | anisa | Filters the frontend sends from URL query params arrive as strings. |
| `BaseCrudService` hooks: `alias`, `relations`, `extendQuery`, `toRow`/`toDetail`, `beforeCreate`/`beforeUpdate`/`beforeDelete`/`beforeRestore` | jobsy `BaseAdminService` | |
| `relationIds` / `detailRelations` / `optionLabel` and `GET options` | **new** | DTO ids (`categoryId`, `tagIds`) are checked (400 for unknown ids) and ManyToMany ids become relation rows; the detail returns `tagIds`; `options` feeds relation selects. |
| `validateDto` (validates the body in a generic controller) | jobsy | `ValidationPipe` cannot see generic `@Body()` types. |
| `TableQueryDto` (class-validator) | jobsy `PrimeTableQueryDto` | `sortOrder` accepts any integer, because the frontend can send `"1"`/`-1`. |
| `BaseCrudController({ entity, createDto, updateDto })` mixin | **new** | Gives accurate Swagger types for every route (anisa/jobsy controllers were `any`). |
| `AllExceptionsFilter`: PG `23505`/`23503` → 409, `23502`/`22P02`/`22001` → 400 | asroortv (QueryFailedError filter) + **new** single shape | `{ statusCode, error, message, path, timestamp }` |

### Auth and access (`apps/api/src/auth`)

| Pattern | Source | Note |
|---|---|---|
| `@AdminResource(path, { read, write })` → `admin/<path>` + guard + Swagger tag | jobsy | |
| `@AdminAccess('read' \| 'write')` on each route, guard **fails closed** | jobsy | A route without an access level gets 403. |
| `@Public()`, `@RequirePermissions()` | anisa / jobsy | |
| `POST auth/sign-in` → `{ accessToken, user }`, `POST auth/sign-in-with-token` | **new** (Fuse frontend contract) | Skeleton: a single admin from env (`ADMIN_EMAIL`/`ADMIN_PASSWORD`), `permissions: ['*']`. |

### Bootstrap (`apps/api/src/main.ts`)

| Pattern | Source |
|---|---|
| `setGlobalPrefix('api')`, port 3000 | frontend `apiUrl = http://localhost:3000/api` |
| `TRUST_PROXY`, CORS from `CORS_ORIGINS` | anisa |
| `helmet`, Swagger toggle (`SWAGGER_ENABLED`) at `/docs` | jobsy |
| `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` | jobsy / anisa |
| env validation (class-validator, `validateEnv`) | **new** |

---

## 2. Frontend ↔ backend contract

### Base URL and auth

- `environment.apiUrl = 'http://localhost:3000/api'`, so the global prefix is `api` and the port is `3000`.
- Requests carry `Authorization: Bearer <accessToken>`.
- `POST /api/auth/sign-in` takes `{ email, password }` and returns `{ accessToken, user }`.
- `POST /api/auth/sign-in-with-token` takes `{ accessToken }` and returns `{ accessToken, user }`.
- `GET /api/auth/me` returns `user`.

### CRUD endpoints (`<resource>` = dasherized name)

| Frontend `BaseCrudService` | Backend | Response |
|---|---|---|
| `getAll()` | `GET admin/<resource>` | `T[]` |
| `getPagination(query)` | `POST admin/<resource>/pagination` | `{ count, data: T[] }` |
| `getArchivePagination(query)` | `POST admin/<resource>/pagination/archive` | `{ count, data: T[] }` |
| `getById(id)` | `GET admin/<resource>/:id` | `T` (404 if not found) |
| `getArchiveById(id)` | `GET admin/<resource>/archive/:id` | `T` |
| `create(body)` | `POST admin/<resource>` | `T` (201) |
| `update(id, body)` | `PUT admin/<resource>/:id` | `T` |
| `delete(id)` | `DELETE admin/<resource>/:id` | `{ deleted: true, id }` (soft delete) |
| `repair(id)` | `GET admin/<resource>/repair/:id` | `T` (restored from archive) |
| relation select | `GET admin/<resource>/options?search=&ids=&limit=&label=` | `{ id, label }[]` |

`options` needs the `read` permission. `search` is a case-insensitive `contains` on the label, `ids` (comma-separated uuids, max 100) returns those rows (to show the current value of a select), `limit` is 1..100 (default 20, at least the number of `ids`), `label` overrides the label column (default: the resource's `optionLabel`, `name`, else `id`). Rows are ordered by label, then id; soft-deleted rows are excluded.

### TableQueryDTO (pagination body)

```ts
{
  first: number;              // offset
  rows: number;               // limit (1..100)
  sortField?: string;         // must be a whitelisted column, otherwise 400
  sortOrder?: 1 | -1 | "1";   // a string is accepted too
  filters?: {
    [field: string]: { value: any; matchMode: string; operator?: 'and' | 'or' }
                   | Array<{ value: any; matchMode: string; operator?: 'and' | 'or' }>;
  };
  globalFilter?: string;      // ILIKE search over the service's tableOptions.searchFields
  categoryId?: string;        // generated per ManyToOne relation (tableOptions.queryFilters): same as filters.categoryId equals
}
```

- **matchMode** values: `startsWith`, `endsWith`, `contains`, `notContains`, `equals`, `notEquals`, `in`, `lt`, `lte`, `gt`, `gte`, `between`, `dateIs`, `dateIsNot`, `dateBefore`, `dateAfter`.
- An empty `value` (`null`, `''`, `[]`) ignores the filter.
- An unknown field in `filters` or `sortField` returns **400**. This is deliberate (jobsy whitelist), but see the open questions below.

### Error format

```json
{ "statusCode": 400, "error": "Bad Request", "message": ["price must be a number ..."], "path": "/api/admin/mahsulot", "timestamp": "..." }
```

`message` is a string or a string array (validation).

### `--fields` syntax (shared by the frontend and the backend)

The parser lives in `src/utils/fields.ts` with no Nest/Angular dependency, so fuse-schematics can copy it verbatim:
`node scripts/sync-fields.mjs <fuse-schematics>/src/utils` copies `fields.ts` and `fields-contract.json`. The contract file lists
valid specs with their parsed form, canonical string and derived DTO keys, plus invalid specs with the expected error text;
both repositories test their parser against it (`src/utils/fields_spec.ts`).

```
name:type[:modifier...][?]
"name:string:unique,price:decimal(12,2):default(0),status:enum(draft|published):default(draft),category:relation(Category),tags:relation(Tag[])?"
```

- Entries are comma-separated; commas inside parentheses do not split (`decimal(12,2)`).
- A missing type means `string`. A trailing `?` (after the type or at the end) makes the field nullable and optional.
- Enum values are separated by `|` (`,` also works inside the parentheses).
- Reserved names: `id`, `createdAt`, `updatedAt`, `deletedAt`. Relation and file fields must not end in `Id`/`Ids` (the key is derived).
- When omitted, the default is `name:string`, which matches the frontend's default grid `name` column and filter.
- `stringifyFields(parseFields(x))` gives the canonical form (modifiers in the order `unique, index, default, min, max, cascade|set-null, label`, then `?`); parsing it again gives the same fields.

| type | DB column | TS / DTO key | Create DTO validation | Swagger | Frontend (suggested) |
|---|---|---|---|---|---|
| `string`, `string(N)` | `varchar(N)` (default 255, or `max(n)`) | `string` | `IsString`, `MaxLength`, `MinLength`, `IsNotEmpty` | `type: String`, `minLength`/`maxLength` | `pInputText`, `contains` |
| `text` | `text` | `string` | `IsString` | `format: 'textarea'` | `textarea`, `contains` |
| `int` | `integer` | `number` | `IsInt`, `Min`/`Max` (int32 bounds by default) | `type: 'integer'` | `p-inputNumber`, `equals`/`gte`/`lte` |
| `number` | `double precision` | `number` | `IsNumber` | `type: Number` | `p-inputNumber` |
| `decimal(p,s)` | `numeric(p,s)` (default 12,2) + string↔number transformer | `number` | `IsNumber({ maxDecimalPlaces: s })`, `±(10^(p-s) - 10^-s)` | `type: Number, format: 'decimal'` | `p-inputNumber [minFractionDigits]` |
| `boolean` | `boolean default false` | `boolean` | optional, `IsBoolean` | `type: Boolean` | `p-toggleSwitch`, `equals` |
| `date` | `timestamptz` | `Date` | `@Type(() => Date)`, `IsDate` | `format: 'date-time'` | `p-datepicker`, `dateIs`/`dateAfter` |
| `json` | `jsonb` | `Record<string, unknown>` | `IsObject` | `type: 'object', additionalProperties: true` | JSON editor |
| `enum(a\|b)` | PG enum `<table>_<field>_enum` | `export enum <Entity><Field>` | `IsEnum` | `enum: X, enumName: 'X'` | `p-select`, `equals` |
| `relation(Category)` | `category_id uuid` + FK + index (ManyToOne) | `categoryId: string` | `IsUUID` | `format: 'uuid'` + `x-relation` | `p-select` from `options` |
| `relation(Tag[])` | join table `<table>_tags` (ManyToMany, CASCADE) | `tagIds: string[]` | `IsArray`, `ArrayUnique`, `IsUUID` each | `isArray` + `x-relation` | `p-multiSelect` from `options` |
| `file(kind)` | `<field>_id uuid` → `media_files` | `imageId: string` | `IsUUID` (+ kind check in the service) | `x-file` | upload widget |
| `file(kind)[]` | join table → `media_files` | `docIds: string[]` | `IsUUID` each | `x-file` | multi upload |

File kinds are `image`, `video`, `audio`, `pdf` and `other`; file fields need the `upload` add-on (`npm run g -- upload`), otherwise the generator stops with that hint.

| modifier | Applies to | Effect |
|---|---|---|
| `unique` | scalars, single relation/file | Unique index; tables are soft-deleted, so it is partial (`WHERE "deleted_at" IS NULL`) and an archived row does not block a new one (restoring a conflicting row returns 409) |
| `index` | scalars, single relation/file | Plain index (single relations always get one) |
| `default(v)` | scalars | Column default, validated against the type and `min`/`max`; `date` accepts only `default(now)`; `json` takes a JSON object/array |
| `min(n)`, `max(n)` | string/text (length), numbers (value), lists (item count) | DTO validation; `string` without a length uses `max` as the column length |
| `cascade`, `set-null` | single relation/file | `ON DELETE`; default `SET NULL` when nullable, otherwise `RESTRICT` (`set-null` needs `?`) |
| `label(field)` | relations | Label column of the target in `x-relation` and searches (default `name`, `title`, else `id`) |

Every field gets an explicit Swagger `type` (`T | null` would otherwise reflect as `object`). Update DTO = `PartialType(CreateDto)`. In JSON, properties are **camelCase** (`createdAt`, `categoryId`); in the DB they are snake_case.

#### OpenAPI extensions

The frontend reads these from `/docs-json` to build relation selects and upload fields. They are set on the entity (FK column and `tagIds`), the create DTO (so also the update DTO) and the query DTO filter:

```ts
'x-relation': { entity: 'Category', endpoint: '/admin/category/options', label: 'name', multiple: false }
'x-file': { kind: 'image', multiple: false }
```

`endpoint` is relative to the API base URL (`/api`). `multiple` is `true` for `relation(T[])` / `file(kind)[]`.

#### Relations at runtime

- The list and pagination join ManyToOne relations (`category` is returned with each row and is searchable via `globalFilter` on `category.<label>`).
- The detail (`GET :id`) also joins ManyToMany relations and adds the id list (`tagIds`).
- On create/update, every id is checked against the target table (400 `categoryId: not found: <id>`); `tagIds: []` or `null` clears the list, an omitted key leaves it unchanged.
- Soft-deleting a referenced row is allowed (only a hard delete hits the `RESTRICT` foreign key).

#### Migrations, permissions and seeds

- A new resource gets `libs/database/src/migrations/<timestamp>-create-<name>.ts`, registered in `migrations/index.ts`. The SQL uses
  TypeORM's own type and constraint naming (primary keys, the `deleted_at` index and join-table indexes keep TypeORM's default names,
  enum types are `<table>_<column>_enum`), so `migration:generate` right after `migration:run` finds no changes.
  Readable names are used where the entity sets them: `UQ_<table>_<column>`, `IDX_<table>_<column>`, `FK_<table>_<column>`.
- Re-running with the same fields writes nothing. Changing the fields of an existing resource only prints a hint: edit the entity and run `npm run migration:generate`. `--no-migration` skips the file.
- `read`/`write` permissions are added to `libs/common/src/permissions.ts`.
- `--seed N` writes a development-only seeder with N rows. Ids are fixed (UUID v5 layout from the resource name and row number), so running it again inserts nothing; rows reference existing target rows in creation order, and the seed is skipped with a warning when a required relation has no rows.

---

## 3. Open questions

1. **`IBaseModel` snake_case vs camelCase.** The frontend `IBaseModel` (copied from asroortv) expects `created_at` and `version_id`. The backend returns camelCase (`createdAt`, `updatedAt`, `deletedAt`) and has no `version_id`. Should the frontend move to camelCase, or should the backend add a snake_case serializer?
2. **Nest 12 / TypeORM 1.x.** The template targets Nest 11 + TypeORM 0.3 (CommonJS, all three projects use it). Nest 12 is ESM-only, so moving needs a separate starter version.
3. **Nest CLI and `--fields`.** Nest CLI 11 rejects unknown flags (`error: unknown option '--fields'`). For now the README recommends `npx -p @angular-devkit/schematics-cli schematics fuse-nest-schematics:crud`. Should the generated project get `@angular-devkit/schematics-cli` as a devDependency plus a `"g:crud"` script?
4. **Re-running `crud`** overwrites existing files (`MergeStrategy.Overwrite`), but the module registration and barrel export are not duplicated. Should it ask first, or add a `--force` flag?
5. **Fuse auth** in the frontend currently calls the mock relative path `api/auth/sign-in`, not `apiUrl`. The interceptor or AuthService needs to change.
6. **i18n.** jobsy has its own i18n for error messages; it was left out (messages are in English).
7. **A real admin entity and roles.** Auth is a skeleton: one admin from env with `permissions: ['*']`. The `@AdminResource` permissions (`product.read`/`product.write`) are already set up and work once roles are added.
8. **Default apps.** `api,bot,worker` is the default. Is `api` alone better?
9. ~~**Money fields.**~~ Answered: `decimal(p,s)` maps to `numeric(p,s)` with a transformer, so the API returns a JSON number (`199.99`). Values beyond 15 significant digits lose precision in JavaScript; use `string` for those.
10. **Unknown filter → 400.** If the frontend's default grid always sends a `name` filter, a resource without a `name` field returns 400. Should unknown filters be ignored instead of rejected?
