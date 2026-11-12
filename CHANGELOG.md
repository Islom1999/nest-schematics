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
- `upload` add-on: `media_files`, lokal yoki S3/MinIO saqlash, tur va hajm tekshiruvi, `admin/files` yo'llari, ommaviy `files/:id` (ETag va Range), ixtiyoriy thumbnail'lar, yetim fayllarni tozalash.
- `upload-tus` add-on: `upload` ustiga tiklanadigan (tus) yuklash; `--engine tusd` (docker servis + hook'lar, sukut bo'yicha) yoki `node` (api ichida `@tus/server`). Yaratishda token va limit tekshiruvi, tugaganda magic-byte tekshiruvi va `media_files` yozuvi, worker orqali tozalash.
- `ai` add-on: `AiService` (OpenRouter / Gemini, `fetch` orqali: generate, stream, vision, json, image), token va narxli `ai_logs`, admin statistikasi; `--chat` (klient SSE chat), `--quota` (foydalanuvchi limitlari).
- `auth-client` add-on: mijoz (ilova foydalanuvchisi) auth: `users`, sessiyalar, `UserGuard`, `@CurrentUser()`, `client/auth/*`, `admin/users`; `--methods phone,email,google,apple,telegram`. `sms` (`eskiz` | `log`) va `mail` (`resend` | `smtp` | `log`) add-on'lari bilan birga: `phone` usuli `sms`ni, `email` usuli `mail`ni talab qiladi.
- `notifications` add-on: `notifications` va `notification_campaigns`, `NotificationService.send()` (avval saqlaydi, keyin FCM push 500 tadan), `--channels telegram,email`, `client/notifications`, admin broadcast va kampaniyalar, worker'da push'ni qayta urinish. `queue` o'rnatilgan bo'lsa, broadcast, telegram/email va qayta urinishlar BullMQ job'lari bo'lib ishlaydi (qaysi biri avval o'rnatilganidan qat'i nazar).
- `redis` add-on: `ioredis` (`REDIS_URL`), sessiya keshi va login limitlari uchun umumiy `CacheStore`, Redis throttler storage, health check, docker-compose servisi; `REDIS_URL` bo'lmasa xotiradagi zaxira.
- `queue` add-on (`redis` kerak): BullMQ, `QueueModule`, `JobsService.enqueue(name, data, opts)` (qayta urinish va backoff), `@JobHandler()`, `GET admin/queues`; `worker` o'rnatilgan bo'lsa, job'lar `apps/worker`da ishlaydi.
- `settings` add-on: `app_settings`, `SettingsService.get/set` (qisqa kesh), `admin/settings` CRUD, `GET settings/public` va texnik ishlar rejimi (klient yo'llarida 503).
- `payment` add-on: to'lov yadrosi (invoice'lar, qat'iy holat mashinasi, idempotent webhook'lar, klient checkout, `admin/payments`) va qulflanadigan ledger'li hamyon (`--mode wallet|order|both`, `auth-client` kerak). Adapterlar: Payme, Click, Uzum, Paynet va inPAY (`npm run g -- payment <payme|click|uzum|paynet|inpay>`).

### Changed

- `crud` endi siz o'zgartirgan fayllarni qayta yozmaydi (ogohlantiradi); `--force` bilan qayta yoziladi.
- `--apps` sukut bo'yicha faqat `api`; `bot` va `worker` add-on sifatida qo'shiladi (`--apps api,bot,worker` ham ishlaydi).
- Auth skeleton o'rniga to'liq admin auth (sign-in javobi endi `refreshToken` va `expiresIn` ham qaytaradi).
- `LoginAttemptLimiter` va sessiya keshini bekor qilish endi asinxron (`CacheStore` orqali, `redis` bilan umumiy bo'ladi): chaqiruvchilar `await` qilishi kerak.

### Fixed

- Swagger: nullable maydonlar (`number?`, `text?`, `string?`, `deletedAt`, `TableQueryDto.sortField/sortOrder/globalFilter`) `{ type: 'object' }` bo'lib chiqardi (`T | null` → `Object`). Endi har bir maydonda aniq `type` bor; `text` → `{ type: 'string', format: 'textarea' }`.
- `AllExceptionsFilter` endi `HttpException` javob tanasidagi qo'shimcha maydonlarni (`message`dan tashqari) javobga o'tkazadi; ilgari ular tashlab yuborilardi.

### Known limitations

- Redis va BullMQ faqat mock'lar bilan sinalgan, haqiqiy Redis bilan e2e yo'q.
- `tusd` Docker bilan tekshirilmagan.
- Uzum, Paynet va inPAY protokol tafsilotlari xotiradan va oldingi loyihalardan olingan; ishlatishdan oldin provayder hujjatlari bilan solishtiring.
- Click tafsilotlari ham xotiradan yozilgan, uni ham hujjat bilan tekshiring.

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
