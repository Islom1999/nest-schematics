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

The parser lives in `src/utils/fields.ts` with no Nest/Angular dependency, so fuse-schematics can copy it verbatim.

```
"name:string,price:number,active:boolean,note:text?,birth:date,status:enum(draft|published)"
```

- Entries are comma-separated, in the form `name:type`.
- A missing type means `string`.
- A trailing `?` makes the field nullable and optional.
- Enum values are separated by `|` (`,` also works inside the parentheses).
- Reserved names: `id`, `createdAt`, `updatedAt`, `deletedAt`.
- When omitted, the default is `name:string`, which matches the frontend's default grid `name` column and filter.

| type | DB column | TS | Create DTO validation | Frontend (suggested) |
|---|---|---|---|---|
| `string` | `varchar(255)` | `string` | `IsString`, `MaxLength(255)`, `IsNotEmpty` | `pInputText`, filter `contains` |
| `text` | `text` | `string` | `IsString` | `textarea`, filter `contains` |
| `number` | `double precision` | `number` | `IsNumber` | `p-inputNumber`, filter `equals`/`gte`/`lte` |
| `boolean` | `boolean default false` | `boolean` | optional, `IsBoolean` | `p-checkbox`/`p-toggleSwitch`, filter `equals` |
| `date` | `timestamptz` | `Date` | `@Type(() => Date)`, `IsDate` | `p-datepicker`, filter `dateIs`/`dateAfter` |
| `enum(a\|b)` | PG enum `<entity>_<field>_enum` | `export enum <Entity><Field>` | `IsEnum` | `p-select`, filter `equals` |

Every field gets an explicit Swagger `type` (`T | null` would otherwise reflect as `object`); `text` is `{ type: 'string', format: 'textarea' }`, `date` is `format: 'date-time'`, `enum` is `enum: [...]`. Update DTO = `PartialType(CreateDto)`. In JSON, properties are **camelCase** (`createdAt`, `isActive`); in the DB they are snake_case.

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
9. **Money fields.** `number` maps to `double precision`. Is a separate `decimal` type needed for prices (`numeric(12,2)`, which comes back as a string)?
10. **Unknown filter → 400.** If the frontend's default grid always sends a `name` filter, a resource without a `name` field returns 400. Should unknown filters be ignored instead of rejected?
