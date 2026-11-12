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

## Add-on'lar

Add-ons are installed into a generated project: `npm run g -- <add-on> [options]` (the `add` word is optional; `--dry-run`, `--force` and `--help` work too). Every add-on is idempotent: a second run changes nothing. Installed add-ons and their options are recorded in `nest-schematics.json`, and an add-on with a dependency refuses to run until it is installed.

| Add-on | Command | Description | Needs |
|---|---|---|---|
| `seed` | `npm run g -- seed <name>` | A seed file in `libs/database/src/seeds`, registered for `npm run seed -- <name>` | - |
| `openapi-client` | `npm run g -- openapi-client --name admin --doc admin --generator typescript-angular --target <dir>` | openapi-generator client target (`typescript-angular`, `dart-dio`, `typescript-fetch`): `openapitools.json` and `api:generate` scripts | - |
| `worker` | `npm run g -- worker` | `apps/worker`: cron jobs on `@nestjs/schedule`; other add-ons register their jobs in it | - |
| `bot` | `npm run g -- bot` | `apps/bot`: Telegram bot on telegraf (`BOT_TOKEN`, empty = disabled) | - |
| `api-logs` | `npm run g -- api-logs` | `server_api_logs`: global request log interceptor, secret masking, `x-request-id`, `@LogPayment()`, `logCron()`, admin routes and retention | - |
| `sms` | `npm run g -- sms <eskiz\|log>` | `SmsModule` / `SmsService.send(phone, text)` in `libs/common/src/sms` | - |
| `mail` | `npm run g -- mail <resend\|smtp\|log>` | `MailModule` / `MailService.send({ to, subject, html, text })` and templates in `libs/common/src/mail` | - |
| `auth-client` | `npm run g -- auth-client --methods phone,email,google,apple,telegram` | Client (app user) auth: `users`, sessions, `UserGuard`, `@CurrentUser()`, `client/auth/*` and `admin/users` | `sms` for `phone`, `mail` for `email` |
| `redis` | `npm run g -- redis` | Redis (`ioredis`, `REDIS_URL`): shared `CacheStore` for session caches and login limits, Redis throttler storage, health check, docker-compose service; in-memory fallback without `REDIS_URL` | - |
| `queue` | `npm run g -- queue` | BullMQ job queues: `QueueModule`, `JobsService.enqueue(name, data, opts)` with retries and backoff, `@JobHandler()`, `GET admin/queues`; jobs run in `apps/worker` when installed | `redis` |
| `settings` | `npm run g -- settings` | `app_settings`: `SettingsService.get/set` with a short cache, `admin/settings` CRUD, `GET settings/public` and maintenance mode (503 on client routes) | - |
| `upload` | `npm run g -- upload` | `media_files` uploads: local or S3/MinIO storage, type/size checks, `admin/files` routes, public `files/:id` with ETag and Range, optional thumbnails, orphan cleanup | - |
| `upload-tus` | `npm run g -- upload-tus --engine tusd\|node` | Resumable (tus) uploads on top of `upload`: `tusd` (docker service + hooks, default) or `node` (`@tus/server` in the api); token and limit checks on create, magic-byte check and `media_files` row on finish, worker cleanup | `upload` |
| `ai` | `npm run g -- ai [--chat] [--quota]` | `AiService` (OpenRouter / Gemini over fetch: generate, stream, vision, json, image), `ai_logs` with tokens and cost, admin stats; `--chat`: client SSE chat; `--quota`: per-user limits | `auth-client` for `--chat` |
| `notifications` | `npm run g -- notifications [--channels telegram,email]` | `notifications` + `notification_campaigns`: `NotificationService.send()` (save, then FCM push in chunks of 500), `client/notifications`, admin broadcast and campaigns, push retry in the worker; runs on BullMQ when `queue` is installed | `auth-client`; `mail` for `--channels email` |
| `payment` | `npm run g -- payment <payme\|click\|uzum\|paynet\|inpay> [--mode wallet\|order\|both]` | Invoices, a strict state machine with idempotent webhooks, client checkout, `admin/payments`, wallets with a locked ledger | `auth-client` (and through it `sms` for `phone` or `mail` for `email` sign-in, whichever methods you picked) |

Payment providers: `payme`, `click`, `uzum`, `paynet` and `inpay`. Run the add-on again with another provider to add it next to the first.

Known limitations: Redis and BullMQ were tested with mocks only, `tusd` was not verified against Docker, and the Click, Uzum, Paynet and inPAY protocol details were written from memory; check them against the provider docs before going live.

## O'rnatish tartibi

Add-ons are order-independent: install them in any order. An add-on that needs another one stops with a message naming the missing add-on and the command to run, then you run it and repeat. Add-ons that work together adapt to whichever is installed: for example `queue` moves `notifications` work onto BullMQ jobs whether `notifications` came first or second.

## Environment kalitlari

Every add-on appends its keys to `.env.example` of the generated project (and to `.env` and `env.validation.ts` when they exist), grouped by add-on, with defaults and comments. Copy missing keys from `.env.example` and fill in the secrets (`REDIS_URL`, provider tokens, `BOT_TOKEN` and so on); a key left empty usually disables that integration.

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

## Swagger va OpenAPI klientlar

Two OpenAPI documents, split by route prefix in `apps/api/src/config/swagger.ts` (the longest matching prefix wins):

| Hujjat | Yo'llar | UI | JSON | Eksport |
|---|---|---|---|---|
| `admin` | `/api/admin/*`, `/api/auth/*` | `/docs/admin` | `/docs/admin-json` | `openapi/admin.json` |
| `client` | everything else | `/docs/client` | `/docs/client-json` | `openapi/client.json` |

- `/docs` shows both documents with a picker. Docs are on outside production. In production they need `SWAGGER_ENABLED=true` plus `SWAGGER_USER` and `SWAGGER_PASSWORD` (basic auth); without the credentials they stay off.
- `operationId` = `<controller><Method>`: `productFindAll`, `productFindAllPagination`, `authSignIn`. Duplicates fail the build of the documents.
- Pages are typed: `@ApiPaginatedResponse(Product)` gives a `PaginatedProduct` schema (`{ count, data: Product[] }`). Enums are named: `@ApiProperty({ ...apiEnum(ProductStatus, 'ProductStatus') })`.
- `npm run swagger:export` writes `openapi/*.json` **without a database** (`SWAGGER_EXPORT=1`: TypeORM does not connect and lifecycle hooks do not run). Keys are sorted, so the files diff cleanly; commit them.

Frontend clients ([openapi-generator](https://openapi-generator.tech), needs Java 11+ or `"useDocker": true` in `openapitools.json`):

```bash
npm run g -- openapi-client --name admin --doc admin --generator typescript-angular --target ../shop-admin/src/app/core/api
npm run g -- openapi-client --name mobile --doc client --generator dart-dio --target ../shop_mobile/packages/api
npm run api:generate:admin   # export + one client
npm run api:generate         # export + every client
```

The add-on pins the generator version in `openapitools.json`, adds `@openapitools/openapi-generator-cli`, and uses these settings: `typescript-angular` gets `ngVersion 20`, `providedIn: root`, `stringEnums`, `withInterfaces`; `dart-dio` gets `pubName`; `typescript-fetch` is also supported. Re-running it with the same name changes nothing.

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
