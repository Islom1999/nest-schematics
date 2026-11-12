# Reja: nest-schematics, "lego" tamoyilidagi backend generatori

**Maqsad:** kichik, toza **standart loyiha** (starter) va uning ustiga CLI orqali qo'shiladigan **mustaqil bo'laklar** (add-on). Har bir bo'lak bitta buyruq bilan qo'shiladi, kerakli paketlarni, `.env` kalitlarini, modulni, migratsiyani va Swagger'ni o'zi ulaydi. Shu bo'lakka mos frontend qismi `fuse-schematics` orqali yaratiladi.

```bash
npx nest-schematics new shop
cd shop
npm run g -- crud category --fields "name:string:unique,slug:string:index"
npm run g -- crud product --fields "name,price:decimal(12,2):default(0),category:relation(Category),image:file(image)?"
npm run g -- auth-client --methods phone,google
npm run g -- upload --storage local
npm run g -- payment payme
npm run g -- payment click
npm run g -- notifications
npm run g -- ai openrouter --chat
npm run g -- api-logs
npm run g -- openapi-client --target ../shop-admin/src/app/core/api
```

**Manba:** BananaTV (`asroortv_anime_api`) va anisa (`anisa-backend`) loyihalaridagi ishlab turgan yechimlar tahlil qilindi. Yaxshi tomonlari olinadi. Ular kod nusxasi emas, toza qayta yoziladi. Topilgan xatolar (6-bo'lim) takrorlanmaydi.

---

## 1. Nima standart, nima CLI orqali qo'shiladi

### 1.1. Standart loyiha (`new`): har bir loyihada bo'ladi

| # | Qism | Izoh |
|---|---|---|
| S1 | Monorepo: `apps/api`, `libs/common`, `libs/database` | hozirgidek; `bot` va `worker` endi alohida add-on |
| S2 | Config va env tekshiruvi | har bir add-on o'z kalitlarini `env.validation` ga qo'shadi (bo'lakli validator) |
| S3 | TypeORM, Postgres, **migratsiyalar** | `DB_SYNCHRONIZE` faqat dev'da; `migrations/` papkasi, `npm run migration:generate/run/revert` |
| S4 | **Admin entity va to'liq admin auth** | `admins`, `admin_roles`, `admin_permissions`; login, refresh token rotatsiyasi, sessiyalar (qurilmalar), `me`, logout. CRUD buni talab qiladi, shuning uchun u standartda |
| S5 | Sessiya (qurilma) kutubxonasi `libs/auth` | admin ham, client ham ishlatadi (2.2-bo'lim) |
| S6 | Base CRUD, PrimeNG pagination, global exception filter | hozirgidek, `GET options` route'i qo'shiladi (relation select uchun) |
| S7 | **Rate limiting** `@nestjs/throttler` | global 100/min; auth route'larida qattiq (masalan login 5/min); to'lov webhook'larida o'chirilgan |
| S8 | **Health check** `/api/health` | `@nestjs/terminus`: DB ping, disk, xotira; `/api/health/live` va `/api/health/ready` |
| S9 | **Seed mexanizmi** | `libs/database/src/seeds/*`, `npm run seed [nomi]`, idempotent; super admin seed'i env'dan |
| S10 | **ESLint, Prettier, Jest** | unit va e2e (`test/app.e2e-spec.ts`); CRUD har modul uchun test ham yaratadi |
| S11 | **Swagger: OpenAPI kontrakti** | admin va client hujjatlari alohida; toza `operationId`; har enum'da `enumName`; DB'siz `npm run swagger:export` (2.11-bo'lim) |
| S12 | Docker | `Dockerfile` va `docker-compose.yml` (postgres); add-on'lar o'z servisini qo'shadi (redis, tusd) |
| S13 | Xavfsizlik bazasi | helmet, CORS, trust proxy, Swagger hujjatlari prod'da faqat env bilan va basic-auth parol env'dan |
| S14 | `npm run g -- ...` skripti | Nest CLI noma'lum flaglarni (`--fields`) qabul qilmaydi, shuning uchun loyihada o'z skriptimiz bo'ladi |

### 1.2. CLI orqali qo'shiladigan bo'laklar (add-on)

| Buyruq | Nima qo'shadi | Talab qiladi |
|---|---|---|
| `crud <nom> --fields ...` | entity, DTO, service, controller, migratsiya, test, seed (ixtiyoriy); `--scope admin\|client\|both` | starter |
| `auth-client --methods ...` | `users` entity, client auth (phone OTP, email+parol, Google, Apple, Telegram), sessiyalar | `sms` (phone uchun) |
| `upload --storage local\|s3` | umumiy fayl moduli (multer), `media_files`, `file(...)` maydon turi | starter |
| `upload-tus --engine tusd\|node` | katta fayllar uchun bo'lib (chunked) yuklash | `upload` |
| `payment <provayder>` | `payme`, `click`, `uzum`, `paynet`, `inpay`; birinchi chaqiruvda umumiy `payments` yadrosi | starter |
| `notifications --channels fcm,telegram,email` | ilova ichidagi bildirishnomalar, push qurilmalar, FCM, broadcast, qayta urinish | `worker` (retry uchun, ixtiyoriy) |
| `ai openrouter\|gemini [--chat] [--quota]` | AI servis, streaming chat, vision, JSON rejim, `ai_logs`, xarajat hisobi | starter |
| `api-logs` | `server_api_logs`, global interceptor, maxfiy maydonlarni yashirish, saqlash muddati | `worker` (tozalash uchun, ixtiyoriy) |
| `openapi-client --target ... --generator ...` | openapi-generator sozlamasi va frontend uchun klient yaratish skriptlari | starter (S11) |
| `worker` | cron ilovasi (`@nestjs/schedule`) | starter |
| `bot` | Telegram bot ilovasi (telegraf) | starter |
| `sms eskiz` | SMS yuborish servisi | starter |
| `mail resend\|smtp` | email servisi va shablonlar | starter |
| `redis` | Redis ulanishi; throttler, kesh va navbatlar Redis'ga o'tadi | starter |
| `queue` | BullMQ navbatlari (push, email va AI uchun) | `redis` |
| `settings` | `app_settings` (kalit-qiymat), texnik ishlar rejimi (maintenance, 503) | starter |
| `seed <nom>` | yangi seed fayli | starter |

> Har bir add-on **idempotent**: ikkinchi marta ishga tushirilsa, hech narsa takrorlanmaydi. O'rnatilgan bo'laklar `nest-schematics.json` faylida yoziladi, shuning uchun bog'liqliklar tekshiriladi. Masalan, `upload-tus` dan oldin `upload` kerakligini aytadi yoki uni o'zi qo'shib beradi.

---

## 2. Har bir bo'lakning tafsiloti

### 2.1. Admin va User entity (S4, `auth-client`)
- **Admin:** `admins` {email unique, passwordHash (argon2), name, isBlocked, lastLoginAt}. U `admin_roles` {name, permissions text[]} bilan bog'lanadi. Ruxsatlar katalogi kodda yoziladi (`<resource>.read|write`), CRUD har yangi resurs uchun uni o'zi qo'shadi. `super` hamma narsaga ruxsat beradi.
- **User:** `users` {bigintId (to'lov hisob raqami), phone unique?, email unique?, name, avatar → media_files?, language, isBlocked, balance (faqat wallet rejimida)}. Qaysi ustunlar bo'lishi tanlangan login usullariga qarab yaratiladi (`googleSub`, `appleSub`, `telegramId`).
- Admin panel uchun: `admin/admins` (CRUD, rol berish), `admin/roles`, `admin/users` (ko'rish, bloklash, sessiyalarini bekor qilish).

### 2.2. To'liq auth va qurilmalarni boshqarish (BananaTV'dagidek)
- **Tokenlar:** access (15m) va refresh (30d). Admin va client uchun alohida secret. Payload: `{sub, sid, typ: 'admin'|'user'}`.
- **Sessiya = qurilma:** `admin_sessions` / `user_sessions`:
  - {deviceId, deviceName, platform, os, appVersion, ip, userAgent, refreshHash, lastUsedAt, expiresAt, revokedAt, revokeReason};
  - client sessiyasiga `pushToken` bog'lanadi; qurilma chiqsa, push ham to'xtaydi.
- **Refresh rotatsiyasi:**
  - har refresh'da yangi juftlik beriladi, eski refresh bekor bo'ladi;
  - **qayta ishlatilgan eski refresh** kelsa, butun sessiya bekor qilinadi (o'g'irlangan tokendan himoya);
  - refresh sha256 bilan saqlanadi (bcrypt shart emas), access token esa saqlanmaydi.
- **Har so'rovda sessiya tekshiruvi:**
  - guard `sid` faolligini tekshiradi, shuning uchun bekor qilish darhol ishlaydi;
  - DB yukini kamaytirish uchun 30 soniyalik xotira keshi bor (`redis` add-on bo'lsa, Redis'da).
- **Limit:** `ADMIN_SESSION_LIMIT` va `USER_SESSION_LIMIT`. Limitdan oshsa, eng eski sessiya chiqariladi.
- **Endpointlar:**
  - client: `GET client/auth/sessions` (`isCurrent` belgisi bilan), `DELETE sessions/:id`, `DELETE sessions/others`, `POST logout` (faqat joriy sessiya), `POST logout-all`;
  - admin uchun ham xuddi shunday;
  - admin panelda: foydalanuvchining sessiyalarini ko'rish va bekor qilish.
- **Login usullari** (`--methods`):
  - `phone`: OTP hash bilan saqlanadi, 3 daqiqa amal qiladi; IP va telefon bo'yicha limit; yuborish Telegram yoki SMS orqali; **"master kod" yo'q**;
  - `email`: parol, forgot/reset (email orqali, `mail` kerak);
  - `google` va `apple`: ID token JWKS orqali **imzosi tekshiriladi**;
  - `telegram`: bot sessiyasi (start → poll → exchange).
- **Admin:** email va parol, forgot/reset, birinchi super admin seed orqali yaratiladi (signup endpoint yo'q).

### 2.3. Fayl yuklash `upload` (anisa'dagidek umumiy controller)
- **`media_files`** {kind (image/video/audio/pdf/other), usage (enum, kengayadigan), storage (local/s3), path, originalName, mime, size, width, height, duration, used, ownerType, ownerId, uploadedBy}.
- **Endpointlar:**
  - `POST files/upload?usage=` (bitta yoki ko'p fayl);
  - `GET files/:id` (ETag, kesh);
  - `GET files/:id/stream` (Range/206);
  - `DELETE files/:id`: faqat egasi yoki admin o'chira oladi.
- **Cheklovlar:**
  - har tur uchun hajm limiti va MIME oq ro'yxati, **har doim** qo'llanadi;
  - fayl nomi tasodifiy;
  - papka `uploads/{kind}/{usage}/{yyyy}/{MM}/{dd}`.
- **Saqlash drayveri** interfeys orqali: `local` yoki `s3` (MinIO ham). Rasm uchun `sharp` bilan kichik nusxa yaratish ixtiyoriy (`--thumbnails`).
- **`used` belgisi va tozalash:** CRUD'dagi `file(...)` maydoni saqlanganda fayl "ishlatilgan" bo'ladi, almashtirilganda eski fayl bo'shaydi. `worker` bo'lsa, 24 soatdan beri ishlatilmagan fayllarni tozalash cron'i qo'shiladi.

### 2.4. Bo'lib yuklash `upload-tus` (tusd)
- **`--engine tusd` (tavsiya):**
  - docker-compose'ga `tusproject/tusd` servisi qo'shiladi;
  - hook'lar `POST internal/tus-hooks` ga keladi: faqat ichki tarmoqdan, `TUS_HOOK_SECRET` bilan;
  - `pre-create` admin yoki user JWT'ni va hajm/tur limitini tekshiradi;
  - `post-finish` faylni storage'ga ko'chiradi va `media_files` qatorini yaratadi;
  - yarim qolgan yuklamalar N kundan keyin tozalanadi.
- **`--engine node`:** `@tus/server` Nest ichida ishlaydi. Kichik loyihalar uchun, alohida servissiz.
- Frontend: fuse-schematics'da `tus-js-client` bilan progress va davom ettirish (resume) qo'llab-quvvatlanadigan upload komponenti.

### 2.5. `--fields` kengaytmasi: relation, unique, index, default
- **Sintaksis** shell uchun xavfsiz: `nom:tur[:modifikator...]`, oxiridagi `?` maydonni ixtiyoriy qiladi.

| Yozuv | Natija |
|---|---|
| `category:relation(Category)` | `ManyToOne` + `categoryId uuid` ustuni; DTO'da `categoryId` (`IsUUID`); filtr; detail'da relation |
| `tags:relation(Tag[])` | `ManyToMany` + join jadval; DTO'da `tagIds: string[]` |
| `email:string:unique` | unique indeks (soft-delete hisobga olinadi: `WHERE deleted_at IS NULL`) |
| `slug:string:index` | oddiy indeks |
| `price:decimal(12,2):default(0)` | `numeric(12,2)` (string↔number transformer bilan), standart qiymat |
| `isActive:boolean:default(true)` | standart qiymat |
| `meta:json` | `jsonb` |
| `code:string(32)` / `title:string:min(3):max(120)` | uzunlik va validator |
| `image:file(image)` / `docs:file(pdf)[]` | `media_files` ga bog'lanish (`upload` kerak) |
| `qty:int`, `rating:number` | `integer` / `double precision` |

- **Relation qoidalari:**
  - nishon entity mavjud bo'lishi kerak, aks holda aniq xato beriladi;
  - `onDelete` `:cascade` yoki `:set-null` modifikatori bilan beriladi.
- **Swagger** relation'ni `x-relation: {entity, endpoint: '/admin/category/options', label: 'name'}` kengaytmasi bilan belgilaydi.
- **Frontend** (`fuse-schematics`):
  - `relation` bo'lsa, `p-select` / `p-multiselect` lazy yuklash va qidiruv bilan (`GET admin/<nom>/options?search=`);
  - `file` bo'lsa, upload komponenti;
  - jadvalda relation nomi ko'rsatiladi.
- **Xavfsiz qayta ishga tushirish:**
  - mavjud fayl sukut bo'yicha **o'zgartirilmaydi** va ogohlantirish beriladi;
  - `--force` qayta yozadi; `--dry-run` nima o'zgarishini ko'rsatadi.
- **Migratsiya:** CRUD o'z migratsiyasini yaratadi (`--no-migration` bilan o'chiriladi).

### 2.6. To'lovlar `payment <provayder>`
- **Yadro** (birinchi chaqiruvda bir marta):
  - `payment_transactions` {provider, externalId unique, amount (tiyin, bigint), state, status, purpose, targetType, targetId, userId, performedAt, cancelledAt, reason, raw jsonb};
  - holatlar mashinasi;
  - `PaymentTarget` interfeysi: to'lov nimani yopadi.
- **Ikki rejim** (`--mode`):
  - `wallet`: BananaTV va anisa'dagidek: balans to'ldiriladi, keyin balansdan sotib olinadi;
  - `order`: to'g'ridan-to'g'ri buyurtma to'lanadi.
  - Ikkalasini birga ham yoqish mumkin.
- **Provayderlar:**
  - **Payme:** JSON-RPC (Check/Create/Perform/Cancel/CheckTransaction, GetStatement), Basic auth, 720 daqiqa timeout, xatolar HTTP 200 bilan; so'rov `id` si **har so'rov uchun alohida** saqlanadi.
  - **Click:** prepare/complete, MD5 imzo tekshiruvi, Click xato kodlari.
  - **Uzum:** check/create/confirm/reverse/status, Basic auth.
  - **Paynet:** Perform/Check/Cancel/GetStatement/GetInformation.
  - **Inpay:** `createTopUp` (token kesh), webhook'da holat qaytadan API'dan olinadi; DB tranzaksiyasi va `pessimistic_write` qulfi bilan.
- **Umumiy qoidalar:**
  - webhook'lar `@Public` + `@SkipThrottle` + to'lov logi bilan ishlaydi;
  - provayder IP oq ro'yxati ixtiyoriy;
  - har bir provayder uchun sandbox so'rovlari asosida e2e testlar.
- **Endpointlar:**
  - `POST client/payments/checkout {provider, amount | orderId}` → `{payUrl}`;
  - admin: tranzaksiyalar jadvali, qo'lda bekor qilish.

### 2.7. OpenRouter AI `ai` (anisa'dagidek)
- **`AiService` fasadi:** provayderlar (`openrouter`, `gemini`) interfeys orqali; `generate`, `stream` (SSE), `vision` (rasm), `json` (sxema bilan tekshirish), `image`.
- **Retry:** 429 va 5xx xatolarda eksponensial kutish bilan qayta urinadi.
- **`ai_logs`** {userId, module, model, promptTokens, completionTokens, costUsd, latencyMs, cacheHit, error}. Prompt va javobni saqlash ixtiyoriy (`AI_LOG_BODIES`).
- **`--chat`:**
  - `ai_chat_sessions` / `ai_chat_messages`;
  - `POST client/ai/chat/stream`: SSE hodisalari `meta → delta → done | error`, xato bo'lsa saqlangan xabar qaytariladi;
  - tizim prompt'lari fayllarda.
- **`--quota`:** kunlik xabar va oylik token limiti (`ai_usage_daily` / `ai_usage_monthly`). Rate limit throttler orqali, `redis` bo'lsa ko'p instansiyada ham ishlaydi.
- **Admin:** foydalanish statistikasi, eng faol foydalanuvchilar, loglar.

### 2.8. API loglar `api-logs` (BananaTV va anisa'dagidek)
- **`server_api_logs`** {type (API/PAYMENT/CRON/AUTH), module, handler, method, url, statusCode, requestBody, responseBody, error, durationMs, userId, userType, ip, requestId, serverId}.
  - Indekslar: `createdAt`, `statusCode`, `userId`, `type`.
- **Global interceptor:**
  - sukut bo'yicha faqat xatolar yoziladi;
  - `API_LOG_MODE=errors|slow|all`, `API_LOG_SLOW_MS`;
  - `x-request-id` header'i qo'shiladi.
- **Maxfiy maydonlar yashiriladi:** `password`, `token`, `refreshToken`, `otp`, `code`, `card`, `authorization` va ro'yxatga qo'shiladigan boshqa maydonlar. Katta body'lar qisqartiriladi.
- **`@LogPayment()` / `logCron()` yordamchilari:** to'lov va cron'lar muvaffaqiyatli bo'lsa ham yoziladi.
- **Saqlash muddati:** `API_LOG_RETENTION_DAYS` (30); `worker` bo'lsa, kunlik tozalash.
- **Admin:** `admin/server-api-logs` pagination va detail; ruxsat `server_api_log.read`.

### 2.9. Bildirishnomalar `notifications`
- **`notifications`** {userId, type, title, body, link, image, meta, readAt, campaignId, pushStatus, pushAttempts, pushError}. **`notification_campaigns`** {target, filters, sentCount, failedCount, createdBy}. Broadcast'ni kampaniya bo'yicha ko'rish oson bo'ladi.
- **Push qurilmalar:** sessiyaga bog'langan `pushToken` (2.2). Agar `auth-client` bo'lmasa, alohida `push_devices` jadvali ishlatiladi.
- **FCM:** `sendEachForMulticast`, 500 talik bo'laklarda yuboriladi; yaroqsiz tokenlar o'chiriladi. Credentials faqat env'dan (`FIREBASE_SERVICE_ACCOUNT_JSON`); **repo'da JSON fayl bo'lmaydi**.
- **Dispatch:** `NotificationService.send(userIds | 'all', payload)`. Avval yozuv saqlanadi, keyin push yuboriladi. `worker` (yoki `queue`) bo'lsa, qayta urinish ishlaydi.
- **Endpointlar:**
  - client: ro'yxat, o'qilmaganlar soni, o'qildi deb belgilash, hammasini o'qildi qilish, push token yozish;
  - admin: broadcast (hammaga, platforma yoki foydalanuvchilar bo'yicha), kampaniyalar tarixi.
- `--channels telegram,email` qo'shimcha kanallarni ulaydi.

### 2.10. Health, throttler, ESLint, Prettier, testlar, seed (standartga kiradi)
- 1.1-jadvaldagi S7–S10.
- `crud` har modul uchun service unit testi va e2e test skeleti yaratadi.
- Seed: CRUD `--seed 20` bilan namunaviy ma'lumot seed'ini ham yaratadi (`@faker-js/faker`, faqat dev).

### 2.11. Swagger va OpenAPI'dan frontend klient (anisa'dagidek, yaxshilangan)
- **Standart loyihada (S11):**
  - hujjatlar `swagger-admin`, `swagger-client` (va ixtiyoriy `swagger-public`) alohida;
  - `operationIdFactory` toza nom beradi (`categoryFindAll`, `authLogin`), tag'lar bir xil uslubda;
  - har enum'da `enumName`; javob turlari `@ApiOkResponse` va pagination uchun umumiy `Paginated<T>` sxema bilan;
  - `npm run swagger:export` **DB'siz** ishlaydi: `SWAGGER_EXPORT=1` bo'lganda TypeORM ulanmaydi;
  - natija `openapi/admin.json`, `openapi/client.json`.
- **`openapi-client` add-on:**
  - `openapitools.json` yaratiladi (openapi-generator-cli versiyasi qotiriladi);
  - har nishon uchun skript qo'shiladi: `typescript-angular` (admin va web), `dart-dio` (mobil), ixtiyoriy `typescript-fetch`;
  - `npm run api:generate` eksport qiladi va hammasini yaratadi.
  - Misol: `npm run g -- openapi-client --name admin --doc admin --generator typescript-angular --target ../shop-admin/src/app/core/api`.
- **fuse-schematics tomoni:**
  - `fuse-feature --openapi` hozirgidek sxemadan forma va jadval yaratadi;
  - yangi rejim: o'zining `HttpClient` servisi o'rniga **yaratilgan klient servislari** ishlatiladi (`--use-client`);
  - `x-relation` va `file` formatlarini o'qiydi.
- **CI tekshiruvi:** eksport qilingan spetsifikatsiya o'zgargan bo'lsa-yu, klient yangilanmagan bo'lsa, ogohlantirish beriladi.

### 2.12. nest-schematics uchun CI va publish
- GitHub Actions: build, unit testlar va **e2e**.
  - E2e: Postgres servisi bilan starter yaratiladi, `crud` x2 (relation bilan) va hamma add-on'lar qo'shiladi, keyin `build`, `lint`, `test`, `migration:run`, `swagger:export` ishlatiladi.
  - Hammasi ikki marta ishga tushirilib, idempotentlik tekshiriladi.
- Publish: `v*` tag'da public npm'ga (`NPM_TOKEN` secret, `--provenance`). Nom: `nest-schematics` (public npm).

---

## 3. Ichki arxitektura (generator yadrosi)

Hozirgi kamchilik: har bir add-on o'z yordamchilarini yozishga majbur. Shuning uchun avval umumiy **"ops" qatlami** yoziladi (`src/utils/ops/*`, hammasi AST asosida va idempotent):

| Yordamchi | Vazifasi |
|---|---|
| `addModuleImport` (yangilangan) | `XModule.forRoot(...)` kabi chaqiruvlarni ham takrorlamaydi |
| `addProvider`, `addController`, `addGlobalProvider` | `APP_GUARD`, `APP_INTERCEPTOR`, `APP_FILTER` |
| `addDependencies` | `package.json` ga paket qo'shadi va o'rnatish vazifasini qo'yadi |
| `mergeEnv` | `.env.example` ga bo'lim qo'shadi va `env.validation` ga kalit va validatorlarni qo'shadi |
| `patchMain` | `main.ts` dagi belgilangan joylarga (`// @ns:bootstrap`) kod qo'shadi |
| `addEntityExport`, `addSeed`, `addMigration` | entity barrel, seed ro'yxati, migratsiya fayli |
| `addCompose` | `docker-compose.yml` ga servis qo'shadi |
| `addPermission` | ruxsatlar katalogiga yozadi |
| `addSwaggerModule` | modulni kerakli Swagger hujjatiga qo'shadi |
| `manifest` | `nest-schematics.json`: o'rnatilgan bo'laklar, versiyalar, tanlangan opsiyalar; `requires()` tekshiruvi |
| `writeSafe` | mavjud faylni o'zgartirmaydi; `--force` va `--dry-run` ni qo'llab-quvvatlaydi |

- Har bir add-on o'z papkasida: `src/add-ons/<nom>/{index.ts, schema.json, files/, index_spec.ts}`.
- Umumiy `add` sxemasi: `npm run g -- add payment payme` ham ishlaydi.
- **`fields.ts` kontrakti:** ikki paketda bir xil nusxa qoladi. Sinxron skript va kontrakt testi qo'shiladi: ikkala paketning testi bir xil misollar to'plamini tekshiradi.

---

## 4. Ish bosqichlari va subagentlar

### 0-bosqich (men, ketma-ket): poydevor
1. "ops" qatlami, `manifest`, `writeSafe`, `add` sxemasi, generatsiya qilingan loyihada `npm run g` skripti.
2. E2e harness: starter yaratish, add-on'larni qo'shish, build/lint/test, Docker'dagi Postgres bilan.
3. nest-schematics CI'ning birinchi versiyasi.

### 1-bosqich (5 ta parallel subagent, har biri o'z worktree'sida)
| Vazifa | Nima |
|---|---|
| **N1. Starter mustahkamlash** | S2, S3 (migratsiyalar), S7, S8, S9, S10, S12, S13 |
| **N2. Admin auth va sessiyalar** | S4, S5: admin entity, rollar, refresh rotatsiyasi, qurilmalar, admin endpointlar |
| **N3. `--fields` v2** | relation, unique, index, default, decimal, json, int, min/max, `file` turi; `options` route; migratsiya; `--force`/`--dry-run` |
| **N4. Swagger kontrakti** | S11: operationId, enumName, `Paginated<T>`, DB'siz eksport, `x-relation`; `openapi-client` add-on |
| **N5. `api-logs` va `worker`/`bot` add-on'lari** | 2.8; hozirgi `--apps` add-on'ga aylantiriladi |

### 2-bosqich (5 ta parallel subagent)
| Vazifa | Nima |
|---|---|
| **N6. `auth-client`** | users, usullar (phone, email, google, apple, telegram), `sms eskiz`, `mail` |
| **N7. `upload`** | 2.3 (local va s3, thumbnails, tozalash) |
| **N8. `payment` yadrosi, Payme va Click** | 2.6 |
| **N9. `notifications`** | 2.9 |
| **N10. `ai`** | 2.7 |

### 3-bosqich (4 ta parallel subagent)
| Vazifa | Nima |
|---|---|
| **N11. `upload-tus`** | tusd va node rejimlari |
| **N12. Uzum, Paynet, Inpay** | 2.6 |
| **N13. `redis`, `queue`, `settings`** | |
| **F1. fuse-schematics tomoni** | relation select, file/tus upload, `--use-client`; admin sahifalari: adminlar va rollar, foydalanuvchilar va sessiyalar, server loglari, bildirishnoma yuborish, to'lov tranzaksiyalari, AI statistikasi |

### 4-bosqich (men)
- Hamma add-on'lar birga ishlatilgan to'liq e2e, README, CHANGELOG.
- Publish: faqat sizning roziligingiz bilan.

---

## 5. Qabul qilingan qarorlar

| # | Savol | Qaror |
|---|---|---|
| D1 | To'lov modeli | `wallet` va `order` ikkalasi ham, sukut bo'yicha `wallet` |
| D2 | Paket | **public**, npm'da `nest-schematics` (MIT). npm nomni rad etsa, `@islom1999/nest-schematics` (public) |
| D3 | `fields.ts` kontrakti | nusxa, sinxron skript va kontrakt testi (alohida paket ochmasdan) |
| D4 | `synchronize` | o'chiq, faqat migratsiyalar |
| D5 | Redis | ixtiyoriy add-on; usiz hammasi xotirada ishlaydi |
| D6 | Parol hash | argon2 |
| D7 | `bot` va `worker` | starter'dan chiqib, add-on bo'ladi |

## 6. BananaTV va anisa'dan takrorlanmaydigan xatolar

1. Telefon OTP uchun qattiq yozilgan "master kod" (`2711`, `OTP_FIXED_CODE`).
2. Google tokenini imzosini tekshirmasdan decode qilish; JWT'ni tekshirmasdan o'qiydigan dekoratorlar.
3. Admin login'da parol tekshiruvi o'chirilgani (anisa).
4. Admin ruxsat dekoratori bor-u, uni o'qiydigan guard yo'qligi (anisa).
5. OTP ochiq matnda saqlanishi (BananaTV).
6. Loglarda parol va tokenlar yashirilmasligi; anisa'da loglar abadiy saqlanadi.
7. Kodda qattiq yozilgan DB va Swagger parollari; repo'dagi Firebase service account JSON.
8. Payme servisida so'rov `id` si singleton'da saqlanishi (bir vaqtdagi so'rovlarda chalkashadi).
9. Client `logout` hamma sessiyani o'chirishi (faqat joriysi o'chishi kerak).
10. Paynet route'ida `@Public()` yo'qligi.
11. `/files/upload` da hajm limiti yo'qligi; har qanday foydalanuvchi istalgan faylni o'chira olishi.
12. Prod'da `synchronize: true`.
