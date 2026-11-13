# nest-schematics

[![npm](https://img.shields.io/npm/v/nest-schematics.svg)](https://www.npmjs.com/package/nest-schematics)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`nest-schematics` NestJS 11 + TypeORM (PostgreSQL) **monorepo** backend (starter) yaratadi va uning ustiga bitta buyruq bilan qo'shiladigan mustaqil bo'laklarni (add-on) qo'shadi: CRUD, admin va client auth, upload, to'lovlar, bildirishnomalar, AI, loglar va boshqalar. Backend [fuse-schematics](https://www.npmjs.com/package/fuse-schematics) (Fuse Admin, Angular + PrimeNG) frontend'ining API kontrakti bilan mos keladi.

Paketning o'z CLI'si bor (`nest-schematics`), `@angular-devkit/schematics-cli` shart emas. Collection'ni Nest CLI bilan ham ishlatish mumkin (pastda).

## Xususiyatlari

- **Monorepo starter**: `apps/api`, `libs/database`, `libs/common`, webpack build; `apps/bot` (telegraf) va `apps/worker` (cron) add-on sifatida
- **Admin auth**: `admins`, rollar va ruxsatlar (`read`/`write`), access + refresh token, sessiyalar, parolni tiklash, birinchi super admin `.env` dan
- **CRUD generator**: entity, DTO'lar (create/update/query), service, controller, module, migratsiya, ruxsatlar va ixtiyoriy seed; hammasi avtomatik ulanadi
- **PrimeNG jadval kontrakti**: `POST pagination` → `{ count, data }`, xavfsiz filter/sort/qidiruv, arxiv (soft delete) va tiklash
- **`--fields`**: `name:string:unique,price:decimal(12,2):default(0),category:relation(Category),tags:relation(Tag[])?`, frontend bilan bir xil sintaksis (relation, file, index, default)
- **16 ta add-on**: `seed`, `openapi-client`, `worker`, `bot`, `api-logs`, `sms`, `mail`, `auth-client`, `redis`, `queue`, `settings`, `upload`, `upload-tus`, `ai`, `notifications`, `payment`
- **Swagger va klient generatsiyasi**: `admin` va `client` OpenAPI hujjatlari, barqaror `operationId`, `npm run swagger:export` (DB'siz)
- **Idempotent**: qayta ishga tushirish hech narsani takrorlamaydi; siz o'zgartirgan fayllar `--force`siz qayta yozilmaydi; `--dry-run` bor

## Talablar

- Node.js `>= 20.19`
- PostgreSQL (generatsiya qilingan loyihada `docker compose up -d postgres` ham bor)
- Ixtiyoriy: Redis (`redis`, `queue` add-on'lari), Java 11+ yoki Docker (`openapi-client` generatori)

## O'rnatish

O'rnatish shart emas, `npx` yetarli:

```bash
npx nest-schematics new shop
```

Global o'rnatish (ixtiyoriy):

```bash
npm install -g nest-schematics
nest-schematics new shop
```

Yaratilgan loyihada `nest-schematics` devDependency sifatida bor, shuning uchun u yerda `npm run g -- <generator> ...` ishlaydi.

## Tezkor boshlash

```bash
# 1. Yangi monorepo (npm install ham ishlaydi; o'tkazib yuborish: --skip-install)
npx nest-schematics new shop
cd shop
cp .env.example .env              # DB_*, ADMIN_EMAIL, ADMIN_PASSWORD va secret'larni to'ldiring
docker compose up -d postgres     # yoki o'zingizning PostgreSQL

# 2. CRUD modul (migratsiya, ruxsatlar va modulga ulash bilan)
npm run g -- crud category --fields "name:string:unique"
npm run g -- crud product --fields "name:string:min(2),price:decimal(12,2):default(0),category:relation(Category)" --seed 10

# 3. Add-on'lar
npm run g -- upload
npm run g -- mail log                         # development: xatlar logga yoziladi
npm run g -- auth-client --methods email      # email usuli `mail` ni talab qiladi

# 4. Ishga tushirish (kutilayotgan migratsiyalar avval ishlaydi)
npm run start:dev                 # http://localhost:3000/api, Swagger: /docs
npm run seed                      # ixtiyoriy: boshlang'ich ma'lumotlar
```

`npm run g -- <generator>` da `add` so'zi ixtiyoriy (`npm run g -- add upload` ham ishlaydi). Umumiy opsiyalar: `--dry-run`, `--force`, `--help`. Generatorlar ro'yxati: `npx nest-schematics --help`.

Nest CLI bilan (generatsiya qilingan loyiha ichida; `--fields` ishlamaydi, monorepoda `-p <app>` shart):

```bash
nest g -c nest-schematics crud product -p api
```

## Schematicslar

### 1. `nest-starter` (aliaslar: `starter`, `new`)

```bash
npx nest-schematics new <nom> [--apps api,bot,worker] [--directory <papka>] [--skip-install]
```

| Option | Default | Description |
|---|---|---|
| `name` | (required) | Project name (`package.json` name, folder name) |
| `--apps` | `api` | Which apps to create. `api` is always included; `bot` and `worker` are installed as the `bot` / `worker` add-ons (`--apps api,bot,worker` works) |
| `--directory` | current folder | Parent folder the project is created in |
| `--skip-install` | `false` | Skip `npm install` |

The generated tree (with `--apps api,bot,worker`):

```
shop-api/
├── apps/
│   ├── api/src/        main.ts, api.module.ts, auth/, health/, navigation/, search/, config/swagger.ts, modules/
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
npm run g -- crud <nom> [--fields "..."] [--seed N] [--no-migration] [--app api] [--path ...] [--skip-import]
```

With the Nest CLI (no `--fields`; in a monorepo `-p <app>` is required):

```bash
nest g -c nest-schematics crud <nom> -p api
```

> Nest CLI 11 rejects unknown flags (`error: unknown option '--fields'`), so use `npm run g -- crud` when you need `--fields`.

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
| `ai` | `npm run g -- ai [openrouter\|gemini] [--chat] [--quota]` | `AiService` (OpenRouter / Gemini over fetch: generate, stream, vision, json, image), `ai_logs` with tokens and cost, admin stats; `--chat`: client SSE chat; `--quota`: per-user limits | `auth-client` for `--chat`; `--quota` needs `--chat` |
| `notifications` | `npm run g -- notifications [--channels telegram,email]` | `notifications` + `notification_campaigns`: `NotificationService.send()` (save, then FCM push in chunks of 500), `client/notifications`, admin broadcast and campaigns, push retry in the worker; runs on BullMQ when `queue` is installed | `auth-client`; `mail` for `--channels email` |
| `payment` | `npm run g -- payment <payme\|click\|uzum\|paynet\|inpay> [--mode wallet\|order\|both]` | Invoices, a strict state machine with idempotent webhooks, client checkout, `admin/payments`, wallets with a locked ledger | `auth-client` (and through it `sms` for `phone` or `mail` for `email` sign-in, whichever methods you picked) |

Payment providers: `payme`, `click`, `uzum`, `paynet` and `inpay`. Run the add-on again with another provider to add it next to the first.

## O'rnatish tartibi

Install an add-on's dependency first (see the **Needs** column above); otherwise the add-on stops with a message naming the missing add-on and the exact command to run, then you run it and repeat. Beyond that the order does not matter, and add-ons that work together adapt to whichever is installed: for example `queue` moves `notifications` work onto BullMQ jobs whether `notifications` came first or second. Typical chains: `redis` → `queue`; `mail` / `sms` → `auth-client` → `payment` / `notifications` / `ai --chat`; `upload` → `upload-tus`. `ai --quota` only works together with `--chat`.

## Environment kalitlari

Every add-on appends its keys to `.env.example` of the generated project (and to `.env` and `env.validation.ts` when they exist), grouped by add-on, with defaults and comments. Copy missing keys from `.env.example` and fill in the secrets; a key left empty usually disables that integration. Main keys:

| Qism | Kalitlar |
|---|---|
| starter | `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `TRUST_PROXY`, `SWAGGER_ENABLED`, `SWAGGER_USER`, `SWAGGER_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`, `DB_SYNCHRONIZE`, `DB_MIGRATIONS_RUN`, `THROTTLE_TTL`, `THROTTLE_LIMIT`, `AUTH_THROTTLE_LIMIT`, `ADMIN_JWT_SECRET`, `ADMIN_REFRESH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_APP_URL` |
| `auth-client` | `USER_JWT_SECRET`, `USER_REFRESH_SECRET`, `USER_SESSION_LIMIT`, `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS`, `BOT_TOKEN` (telegram) |
| `sms`, `mail` | `SMS_PROVIDER`, `ESKIZ_EMAIL`, `ESKIZ_PASSWORD`; `MAIL_PROVIDER`, `MAIL_FROM`, `RESEND_API_KEY`, `SMTP_*` |
| `redis` | `REDIS_URL` |
| `upload`, `upload-tus` | `UPLOAD_STORAGE`, `UPLOAD_DIR`, `UPLOAD_PUBLIC_URL`, `UPLOAD_MAX_*_MB`, `S3_*`; `TUS_HOOK_SECRET`, `TUS_DIR`, `TUS_EXPIRE_HOURS` |
| `api-logs` | `API_LOG_MODE`, `API_LOG_RETENTION_DAYS`, `API_LOG_MASK_KEYS`, `API_LOG_SLOW_MS` |
| `ai` | `AI_PROVIDER`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `AI_CHAT_*`, `AI_DAILY_MESSAGES`, `AI_MONTHLY_TOKENS` |
| `notifications`, `bot` | `FIREBASE_SERVICE_ACCOUNT_JSON`, `NOTIFICATION_PUSH_MAX_ATTEMPTS`; `BOT_TOKEN` |
| `payment` | `PAYMENT_RETURN_URL`, `PAYMENT_INVOICE_TTL_MINUTES`, `PAYMENT_MIN_AMOUNT`, `PAYMENT_MAX_AMOUNT`; per provider `PAYME_*`, `CLICK_*`, `UZUM_*`, `PAYNET_*`, `INPAY_*` (credentials, `*_ALLOWED_IPS`) |

## API kontrakti

Every CRUD resource (`npm run g -- crud <nom>`) exposes these endpoints, which match the frontend `BaseCrudService`:

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

Admin auth (`/api/auth/*`):

- `POST /api/auth/sign-in` `{ email, password }` → `{ accessToken, refreshToken, expiresIn, user }`
- `POST /api/auth/refresh` (refresh token rotation; a reused token revokes the session), `POST /api/auth/sign-in-with-token`
- `POST /api/auth/sign-out`, `POST /api/auth/sign-out-all`, `GET /api/auth/me`, `POST /api/auth/change-password`
- `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `DELETE /api/auth/sessions/others`
- `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` (the email goes through the `mail` add-on)
- `GET /api/navigation` (menu filtered by the admin's permissions), `POST /api/search`, `GET /api/admin/me/notifications`
- The first super admin is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`; `admin/admins`, `admin/roles` and `admin/permissions` manage the rest.

See [docs/patterns.md](docs/patterns.md) for the full contract (the TableQueryDTO format, matchModes, the error format) and where each pattern came from.

## Swagger va OpenAPI klientlar

Two OpenAPI documents, split by route prefix in `apps/api/src/config/swagger.ts` (the longest matching prefix wins):

| Hujjat | Yo'llar | UI | JSON | Eksport |
|---|---|---|---|---|
| `admin` | `/api/admin/*`, `/api/auth/*`, `/api/navigation`, `/api/search` | `/docs/admin` | `/docs/admin-json` | `openapi/admin.json` |
| `client` | everything else (`/api/health`, `client/*` and so on) | `/docs/client` | `/docs/client-json` | `openapi/client.json` |

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

## Fuse frontend bilan ulash

Backend [fuse-schematics](https://www.npmjs.com/package/fuse-schematics) (Fuse Admin, Angular + PrimeNG) uchun mo'ljallangan: jadval kontrakti (`POST <nom>/pagination` → `{ count, data }`), `/options` yo'li va `x-relation` / `x-file` kengaytmalari frontend `--fields` va `fuse-feature` generatori bilan mos keladi. `--fields` parseri ikki paketda bir xil ([docs/patterns.md](docs/patterns.md), `scripts/sync-fields.mjs`).

Odatiy ish tartibi:

```bash
# backend: resurs yarating va OpenAPI hujjatlarini eksport qiling (DB kerak emas)
npm run g -- crud product --fields "name:string,price:decimal(12,2),category:relation(Category)"
npm run swagger:export                       # openapi/admin.json, openapi/client.json

# frontend (fuse-schematics loyihasida): har bir admin/<nom> resursi uchun sahifa
schematics fuse-schematics:openapi --openapi ../shop/openapi/admin.json
# yoki bitta modul, xuddi shu --fields bilan
schematics fuse-schematics:crud product --fields "name:string,price:decimal(12,2),category:relation(Category)"
```

Frontend uchun tayyor (generatsiya qilingan) klient servislari kerak bo'lsa, `openapi-client` add-on'i bilan `typescript-angular` klientini yarating (yuqoridagi "Swagger va OpenAPI klientlar" bo'limi). `fuse-schematics` buyruqlari uning README'sida yozilgan.

> `fuse-feature --use-client` (yaratilgan klient servislaridan foydalanish rejimi) hozircha faqat rejada ([REJA-lego.md](REJA-lego.md)); `fuse-schematics` 2.0.0 da u yo'q, shuning uchun u hujjatlashtirilmagan.

## Ma'lum cheklovlar

- **To'lov provayderlari** (Payme, Click, Uzum, Paynet, inPAY) hech qachon provayder sandbox'iga qarshi sinalmagan; testlar faqat o'zimiz yozgan simulyatsiyalar bilan. Uzum, Paynet va inPAY protokol tafsilotlari xotiradan va oldingi loyihalardan yozilgan, Click ham xotiradan. Ishlatishdan oldin provayder hujjatlari va sandbox bilan tekshiring.
- **Redis va BullMQ** faqat mock'lar bilan sinalgan; haqiqiy Redis bilan e2e yo'q.
- **`upload-tus`**: sukut bo'yicha `--engine tusd` Docker bilan tekshirilmagan; `--engine node` (api ichida `@tus/server`) sinalgan.
- Generatsiya qilingan loyihada `npx tsc --noEmit` `TS4094` xatosini beradi (`BaseCrudController` va undan meros olgan controller'lar: "Property 'service' of exported anonymous class type may not be private or protected"). `npm run build` (webpack) va `npm run lint` o'tadi.

## Rivojlantirish

```bash
npm install
npm run build          # tsc
npm test               # build + jasmine
```

Lokal sinash (paketning o'z CLI'si bilan):

```bash
npm run build
node bin/nest-schematics.js new demo-api --skip-install --directory /tmp
scripts/e2e.sh        # paketni pack qiladi, loyiha yaratadi, add-on'larni qo'shadi, build/lint/test va API'ni PostgreSQL bilan ishga tushiradi
```

CI (GitHub Actions): `test` (Node 20 va 22), `e2e` (Postgres servisi) va `v*` tag'da `publish`. Publish npm **trusted publishing (OIDC)** orqali ishlaydi: `NPM_TOKEN` secret'i yo'q, job'da `id-token: write` ruxsati bor, `npm@latest` o'rnatiladi va `npm publish --access public` provenance bilan chiqaradi; tag `package.json` versiyasiga (`v<version>`) teng bo'lishi shart.

## Litsenziya

[MIT](LICENSE) © Islom Karimov

---

## English

**nest-schematics** generates a NestJS 11 + TypeORM (PostgreSQL) monorepo backend (`apps/api`, plus `libs/database` and `libs/common`) and 16 add-ons you install one command at a time: `seed`, `openapi-client`, `worker`, `bot`, `api-logs`, `sms`, `mail`, `auth-client`, `redis`, `queue`, `settings`, `upload`, `upload-tus`, `ai`, `notifications` and `payment`. Generated CRUD resources follow the REST contract of the [fuse-schematics](https://www.npmjs.com/package/fuse-schematics) Angular/PrimeNG admin frontend: `POST admin/<name>/pagination` returns `{ count, data }`, with archive (soft delete) and restore routes.

```bash
npx nest-schematics new shop                 # --apps api,bot,worker  --skip-install  --directory <dir>
cd shop
cp .env.example .env                         # fill in DB_*, ADMIN_EMAIL, ADMIN_PASSWORD, secrets
docker compose up -d postgres
npm run g -- crud category --fields "name:string:unique" --seed 5
npm run g -- crud product --fields "name:string:min(2),price:decimal(12,2):default(0),status:enum(draft|published),category:relation(Category),tags:relation(Tag[])?"
npm run g -- upload                          # add-ons: npm run g -- <add-on> [options]
npm run start:dev                            # http://localhost:3000/api, Swagger at /docs
```

`--fields` takes `name:type[:modifier...][?]`. Types: `string`, `string(N)`, `text`, `int`, `number`, `decimal(p,s)`, `boolean`, `date`, `json`, `enum(a|b)`, `relation(Entity)` (ManyToOne), `relation(Entity[])` (ManyToMany) and `file(kind)`/`file(kind)[]` (needs the `upload` add-on). Modifiers: `unique` (partial unique index on soft-deleted tables), `index`, `default(v)`, `min(n)`, `max(n)`, `cascade`, `set-null` and `label(field)`; a trailing `?` makes a field nullable. Each new resource gets a TypeORM migration (`--no-migration` to skip), `read`/`write` permissions, a `GET admin/<name>/options` route for selects and, with `--seed N`, a development seed. Relations and files carry `x-relation` / `x-file` OpenAPI extensions for the frontend. The module is registered in `apps/<app>/src/<app>.module.ts` via the TypeScript AST and is never added twice. Add-ons are idempotent; one with a dependency stops and names the add-on to install first.

Two OpenAPI documents (`/docs/admin`, `/docs/client`) with stable `operationId`s are exported without a database by `npm run swagger:export`; the `openapi-client` add-on turns them into Angular, Dart or fetch clients.

Known limitations: the payment providers (Payme, Click, Uzum, Paynet, inPAY) were never tested against a provider sandbox, and the Uzum, Paynet and inPAY protocols were written from memory and older projects; Redis and BullMQ were tested only with mocks; the default `tusd` engine of `upload-tus` was not verified with Docker (`--engine node` is tested); `tsc --noEmit` in a generated project reports TS4094 while `npm run build` and `npm run lint` pass.

Requires Node.js >= 20.19. MIT licensed. Publishing uses npm trusted publishing (OIDC), no long-lived token.
