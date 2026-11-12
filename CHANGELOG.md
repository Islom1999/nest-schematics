# Changelog

## Unreleased

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
