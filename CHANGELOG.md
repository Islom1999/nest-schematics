# Changelog

## Unreleased

### Added

- Paket nomi endi `nest-schematics` (public npm) va o'z CLI'si bor: `npx nest-schematics new shop`, loyiha ichida `npm run g -- crud ...` (`add` so'zi ixtiyoriy, `--dry-run`, `--force`, `--help`).
- Add-on'lar uchun umumiy, idempotent yordamchilar (`src/utils/ops`): modul massivlari (`X.forRoot()` takrorlanmaydi), global provider'lar, import'lar, `package.json`, `.env.example` + `.env` + `env.validation.ts`, `main.ts` markerlari, docker-compose, manifest.
- `nest-schematics.json` manifesti: o'rnatilgan bo'laklar va ularning opsiyalari; bo'laklar bir-biriga bog'liqligini tekshiradi.
- `scripts/e2e.sh`: paketni pack qilib loyiha yaratadi, CRUD va `scripts/e2e.d/*` bo'laklarini qo'shadi, ikkinchi ishga tushirishda hech narsa o'zgarmasligini tekshiradi, build qiladi va API'ni PostgreSQL bilan ishga tushiradi.
- GitHub Actions: testlar (Node 20/22), e2e (Postgres servisi), `v*` tag'da npm'ga publish (`NPM_TOKEN`, provenance).
- `docs/ADDON-GUIDE.md`: yangi bo'lak yozish qoidalari.
- Starter mustahkamlandi: sxema faqat migratsiyalar orqali (`DB_SYNCHRONIZE=false`, ishga tushganda advisory lock bilan migratsiya), `/api/health` (`/live`, `/ready`), global rate limit (`@nestjs/throttler`, `@AuthThrottle()`), seed mexanizmi (`npm run seed`, `seed` add-on), ESLint 9 + Prettier + Jest, Dockerfile va docker-compose.
- Admin auth: `admins`, `admin_roles`, `admin_sessions`; argon2, access + refresh token (alohida secret'lar), refresh rotatsiyasi va qayta ishlatilgan token'da sessiyani bekor qilish, qurilmalar ro'yxati va bekor qilish, sessiya limiti, `admin/admins`, `admin/roles`, `admin/permissions`, birinchi super admin `.env` dan.
- `--fields` v2: `string(N)`, `int`, `decimal(p,s)`, `json`, `relation(T)`, `relation(T[])`, `file(kind)`; `unique`, `index`, `default(v)`, `min`/`max`, `cascade`/`set-null`, `label(field)`. CRUD o'z migratsiyasini, ruxsatlarini va `GET admin/<nom>/options` (select uchun) yo'lini yaratadi.
- Swagger kontrakti: `/docs/admin` va `/docs/client` hujjatlari, barqaror `operationId`, nomlangan enum'lar, `Paginated<Model>` sxemasi, `x-relation`/`x-file`; `npm run swagger:export` DB'siz ishlaydi. `openapi-client` add-on (typescript-angular, dart-dio, typescript-fetch).
- Add-on'lar: `worker`, `bot` (endi starter'dan alohida), `api-logs` (`server_api_logs`, maxfiy maydonlarni yashirish, `x-request-id`, saqlash muddati).

### Changed

- `crud` endi siz o'zgartirgan fayllarni qayta yozmaydi (ogohlantiradi); `--force` bilan qayta yoziladi.
- `--apps` sukut bo'yicha faqat `api`; `bot` va `worker` add-on sifatida qo'shiladi (`--apps api,bot,worker` ham ishlaydi).
- Auth skeleton o'rniga to'liq admin auth (sign-in javobi endi `refreshToken` va `expiresIn` ham qaytaradi).

### Fixed

- Swagger: nullable maydonlar (`number?`, `text?`, `string?`, `deletedAt`, `TableQueryDto.sortField/sortOrder/globalFilter`) `{ type: 'object' }` bo'lib chiqardi (`T | null` → `Object`). Endi har bir maydonda aniq `type` bor; `text` → `{ type: 'string', format: 'textarea' }`.

## 0.1.0 (2026-11-12)

Birinchi versiya.

### nest-starter (`starter`, `new`)

- NestJS 11 + TypeORM 0.3 (PostgreSQL) monorepo: `apps/api` + ixtiyoriy `apps/bot` (telegraf) va `apps/worker` (`@nestjs/schedule`), `libs/database`, `libs/common`; webpack build.
- `--apps`, `--directory`, `--skip-install`; `gitignore` → `.gitignore`.
- API: `/api` prefix, ValidationPipe, helmet, CORS (`CORS_ORIGINS`), `TRUST_PROXY`, Swagger (`/docs`), env validatsiya.
- Auth skeleton: `POST auth/sign-in`, `auth/sign-in-with-token`, `auth/me`; `@AdminResource` + `@AdminAccess` (fail-closed guard).
- `BaseCrudService` / `BaseCrudController` (PrimeNG `TableQueryDTO` → `{ count, data }`, arxiv, tiklash), `AllExceptionsFilter`, `SnakeNamingStrategy`, migratsiya skriptlari.

### nest-crud (`crud`, `resource`)

- Entity (`libs/database/src/entities` + barrel), create/update/query DTO, service, controller (`admin/<nom>`), module.
- `--fields` (`string|text|number|boolean|date|enum(a|b)`, `?` = nullable) — parser `src/utils/fields.ts` frontend bilan umumiy.
- Modul `apps/<app>/src/<app>.module.ts` ga AST orqali, takrorlanmasdan ulanadi; Nest CLI `-p <app>` qo'llab-quvvatlanadi.
