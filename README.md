# Fuse Nest Schematics

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

These schematics generate a NestJS 11 + TypeORM (PostgreSQL) **monorepo** backend and its CRUD modules. The backend matches the API contract of the [fuse-schematics](https://www.npmjs.com/package/fuse-schematics) (Fuse Admin, Angular + PrimeNG) frontend exactly.

## Xususiyatlari

- **Monorepo starter**: `apps/api`, `apps/bot` (telegraf), `apps/worker` (cron), `libs/database`, `libs/common`, webpack build
- **CRUD generator**: entity, DTOs (create/update/query), service, controller and module, all wired up automatically
- **PrimeNG table contract**: `POST pagination` → `{ count, data }`, safe filter/sort/search, archive (soft delete) and restore
- **`--fields`**: `name:string:unique,price:decimal(12,2):default(0),category:relation(Category),tags:relation(Tag[])?`, the same syntax as the frontend (relations, files, indexes, defaults), plus a migration, permissions and an optional seed
- **Auth skeleton**: JWT `sign-in`, `@AdminResource` with read/write permissions, a fail-closed guard
- **Swagger, helmet, CORS, env validation, and a single error format** (PG errors → 400/409)

## Talablar

- Node.js `>= 20.19`
- PostgreSQL
- `@angular-devkit/schematics-cli` (via `npx` or a global install)

## O'rnatish

```bash
npm install -g @angular-devkit/schematics-cli
npm install -g fuse-nest-schematics
```

Lokal (loyiha ichida):

```bash
npm install --save-dev fuse-nest-schematics @angular-devkit/schematics-cli
```

## Tezkor boshlash

```bash
# 1. Yangi monorepo
schematics fuse-nest-schematics:starter shop-api
cd shop-api
cp .env.example .env            # DB_* va ADMIN_* ni to'ldiring

# 2. CRUD modul
npm install --save-dev fuse-nest-schematics @angular-devkit/schematics-cli
npx schematics fuse-nest-schematics:crud mahsulot --fields "name:string,price:number,active:boolean"

# 3. Ishga tushirish
npm run start:dev               # http://localhost:3000/api, Swagger: /docs
```

## Schematicslar

### 1. `nest-starter` (aliaslar: `starter`, `new`)

```bash
schematics fuse-nest-schematics:starter <nom> [--apps api,bot,worker] [--directory <papka>] [--skip-install]
```

| Option | Default | Description |
|---|---|---|
| `name` | (required) | Project name (`package.json` name, folder name) |
| `--apps` | `api,bot,worker` | Which apps to create. `api` is always included |
| `--directory` | current folder | Parent folder the project is created in |
| `--skip-install` | `false` | Skip `npm install` |

The generated tree (with `--apps api,bot,worker`):

```
shop-api/
├── apps/
│   ├── api/src/        main.ts, api.module.ts, auth/, config/swagger.ts, modules/
│   ├── bot/src/        main.ts, bot.module.ts, bot.service.ts (telegraf)
│   └── worker/src/     main.ts, worker.module.ts, worker.service.ts (@Cron)
├── libs/
│   ├── database/src/   base.entity.ts, entities/, database.module.ts, data-source.ts, snake-naming.strategy.ts
│   └── common/src/     base/ (BaseCrudService, BaseCrudController), dto/, query/, decorators/, filters/, config/
├── nest-cli.json       monorepo + webpack
├── tsconfig.json       @app/common, @app/database
├── .env.example
├── .gitignore
└── package.json        build:<app>, start:dev:<app>, start:prod:<app>, migration:*
```

### 2. `nest-crud` (aliaslar: `crud`, `resource`)

Run it inside the monorepo the starter created:

```bash
npx schematics fuse-nest-schematics:crud <nom> [--fields "..."] [--seed N] [--no-migration] [--app api] [--path ...] [--skip-import]
```

With the Nest CLI (no `--fields`; in a monorepo `-p <app>` is required):

```bash
nest g -c fuse-nest-schematics crud <nom> -p api
```

> Nest CLI 11 rejects unknown flags (`error: unknown option '--fields'`), so use `schematics` (schematics-cli) when you need `--fields`.

| Option | Default | Description |
|---|---|---|
| `name` | (required) | Resource name. Route: `admin/<dasherized-name>` |
| `--fields`, `-f` | `name:string` | Field list (see below) |
| `--app` | `api` (or the app from Nest CLI `-p`) | `apps/<app>` |
| `--path` | `apps/<app>/src/modules` | Folder the module folder is created in |
| `--module` | `apps/<app>/src/<app>.module.ts` | Root module to register in |
| `--db-lib` | `libs/database/src` | The entity goes into `<dbLib>/entities` |
| `--skip-import` | `false` | Do not register the module |
| `--no-migration` | (migration on) | Do not write `libs/database/src/migrations/<timestamp>-create-<nom>.ts` |
| `--seed N` | — | Write `libs/database/src/seeds/<nom>.seed.ts` with N demo rows (development only, 1..1000) |
| `--force` | `false` | Overwrite generated files you have edited |

Natija (`crud mahsulot`):

```
libs/database/src/entities/
├── mahsulot.entity.ts          # @Entity({ name: 'mahsulot' }) extends BaseEntity
└── index.ts                    # + export * from './mahsulot.entity';
libs/database/src/migrations/
├── <timestamp>-create-mahsulot.ts  # CREATE TABLE + indexes, FKs, join tables, enum types
└── index.ts                    # + CreateMahsulot<timestamp>
libs/database/src/seeds/mahsulot.seed.ts   # only with --seed N (+ seeds/index.ts)
libs/common/src/permissions.ts  # + { resource: 'mahsulot', actions: ['read', 'write'] }
apps/api/src/modules/mahsulot/
├── dto/
│   ├── create-mahsulot.dto.ts  # class-validator + Swagger
│   ├── update-mahsulot.dto.ts  # PartialType
│   └── query-mahsulot.dto.ts   # TableQueryDto
├── mahsulot.service.ts         # extends BaseCrudService (globalFilter: string/text fields)
├── mahsulot.controller.ts      # @AdminResource('mahsulot') extends BaseCrudController(...)
└── mahsulot.module.ts
apps/api/src/api.module.ts      # + MahsulotModule (AST, no duplicates)
```

Re-running with the same options changes nothing: registrations are not duplicated and no second migration is written. Files you have edited are kept unless you pass `--force`. Changing the fields of an existing resource does not generate a migration; edit the entity (or re-run with `--force`) and then run `npm run migration:generate`.

#### `--fields` sintaksisi

```
name:type[:modifier...][?]   # comma-separated; commas inside (...) do not split
```

```bash
npm run g -- crud category --fields "name:string:unique,slug:string(80):index,active:boolean:default(true)" --seed 5
npm run g -- crud tag --fields "name:string:unique"
npm run g -- crud product --fields "name:string:min(2):max(120),price:decimal(12,2):default(0),qty:int:default(0),meta:json?,status:enum(draft|published):default(draft),category:relation(Category),tags:relation(Tag[])?" --seed 10
```

| type | DB | DTO validation | Swagger |
|---|---|---|---|
| `string`, `string(N)` | `varchar(N)` (255, or `max(n)`) | `IsString`, `MaxLength`, `MinLength`, `IsNotEmpty` | `type: String` |
| `text` | `text` | `IsString` | `format: 'textarea'` |
| `int` | `integer` | `IsInt`, `Min`/`Max` (int32) | `type: 'integer'` |
| `number` | `double precision` | `IsNumber` | `type: Number` |
| `decimal(p,s)` | `numeric(p,s)` (default 12,2), returned as a number | `IsNumber({ maxDecimalPlaces: s })`, ±limit | `type: Number, format: 'decimal'` |
| `boolean` | `boolean default false` | optional, `IsBoolean` | |
| `date` | `timestamptz` | `IsDate` | `format: 'date-time'` |
| `json` | `jsonb` | `IsObject` | `type: 'object'` |
| `enum(a\|b)` | PG enum `<table>_<field>_enum` | `IsEnum` | `enum: X, enumName: 'X'` |
| `relation(Category)` | `category_id uuid` + FK + index (ManyToOne) | `categoryId`: `IsUUID` | `x-relation` |
| `relation(Tag[])` | join table `<table>_tags` (ManyToMany) | `tagIds`: `IsUUID` each, `ArrayUnique` | `x-relation` |
| `file(image)`, `file(pdf)[]` | FK / join table to `media_files` (needs `npm run g -- upload`) | `imageId` / `docIds` | `x-file` |

File kinds: `image`, `video`, `audio`, `pdf`, `other`.

| modifier | Effect |
|---|---|
| `unique` | Unique index; on soft-deleted tables it is partial: `WHERE deleted_at IS NULL` |
| `index` | Plain index |
| `default(v)` | Column default, checked against the type (`default(now)` for dates) |
| `min(n)`, `max(n)` | Length for strings, value for numbers, item count for lists |
| `cascade`, `set-null` | `ON DELETE` of a single relation/file (default: `SET NULL` when nullable, otherwise `RESTRICT`) |
| `label(field)` | Field shown for a relation in selects (default: `name`, `title`, else `id`) |

- A trailing `?` makes the field nullable and optional; a missing type means `string`.
- `id`, `createdAt`, `updatedAt` and `deletedAt` are reserved (they come from `BaseEntity`).
- A relation target must exist first (`libs/database/src/entities/<target>.entity.ts`); otherwise the generator says which `crud` command to run.
- Relations load in the detail (`GET :id` returns `category` and `tagIds`); `categoryId` can also be sent as a top-level filter in the pagination body.

OpenAPI extensions for the frontend (on the entity, the create DTO and the query DTO):

```ts
'x-relation': { entity: 'Category', endpoint: '/admin/category/options', label: 'name', multiple: false }
'x-file': { kind: 'image', multiple: false }
```

## API kontrakti

Every CRUD resource exposes these endpoints, which match the frontend `BaseCrudService`:

| Metod | Yo'l | Javob |
|---|---|---|
| GET | `/api/admin/<nom>` | `T[]` |
| POST | `/api/admin/<nom>/pagination` | `{ count, data }` |
| POST | `/api/admin/<nom>/pagination/archive` | `{ count, data }` |
| GET | `/api/admin/<nom>/options?search=&ids=&limit=` | `{ id, label }[]` (selects, `read` permission) |
| GET | `/api/admin/<nom>/:id` | `T` |
| GET | `/api/admin/<nom>/archive/:id` | `T` |
| POST | `/api/admin/<nom>` | `T` |
| PUT | `/api/admin/<nom>/:id` | `T` |
| DELETE | `/api/admin/<nom>/:id` | `{ deleted, id }` (soft delete) |
| GET | `/api/admin/<nom>/repair/:id` | `T` (restore) |

Auth:

- `POST /api/auth/sign-in` `{ email, password }` → `{ accessToken, user }`
- `POST /api/auth/sign-in-with-token`
- `GET /api/auth/me`

See [docs/patterns.md](docs/patterns.md) for the full contract (the TableQueryDTO format, matchModes, the error format) and where each pattern came from.

## Rivojlantirish

```bash
npm install
npm run build          # tsc
npm test               # build + jasmine
```

Test locally:

```bash
npm run build
schematics ./src/collection.json:starter demo-api --skip-install --dry-run=false
```

## Litsenziya

[MIT](LICENSE) © Islom Karimov

---

## English

**fuse-nest-schematics** generates a NestJS 11 + TypeORM (PostgreSQL) monorepo backend (`apps/api`, optional `apps/bot` on telegraf and `apps/worker` on `@nestjs/schedule`, plus `libs/database` and `libs/common`). It also generates CRUD resources whose REST contract matches the [fuse-schematics](https://www.npmjs.com/package/fuse-schematics) Angular/PrimeNG admin frontend: `POST admin/<name>/pagination` returns `{ count, data }`, with archive (soft delete) and restore routes.

```bash
npm i -g @angular-devkit/schematics-cli fuse-nest-schematics
schematics fuse-nest-schematics:starter shop-api            # --apps api,bot,worker --skip-install
cd shop-api
npx schematics fuse-nest-schematics:crud category --fields "name:string:unique" --seed 5
npx schematics fuse-nest-schematics:crud product --fields "name:string:min(2),price:decimal(12,2):default(0),status:enum(draft|published),category:relation(Category),tags:relation(Tag[])?"
# or, without --fields (the Nest CLI rejects unknown flags):
nest g -c fuse-nest-schematics crud product -p api
```

`--fields` takes `name:type[:modifier...][?]`. Types: `string`, `string(N)`, `text`, `int`, `number`, `decimal(p,s)`, `boolean`, `date`, `json`, `enum(a|b)`, `relation(Entity)` (ManyToOne), `relation(Entity[])` (ManyToMany) and `file(kind)`/`file(kind)[]` (needs the upload add-on). Modifiers: `unique` (partial unique index on soft-deleted tables), `index`, `default(v)`, `min(n)`, `max(n)`, `cascade`, `set-null` and `label(field)`; a trailing `?` makes a field nullable. Each new resource gets a TypeORM migration (`--no-migration` to skip), `read`/`write` permissions, a `GET admin/<name>/options` route for selects and, with `--seed N`, a development seed. Relations and files carry `x-relation` / `x-file` OpenAPI extensions for the frontend. The generated module is registered in `apps/<app>/src/<app>.module.ts` via the TypeScript AST and is never added twice. Requires Node.js >= 20.19. MIT licensed.
