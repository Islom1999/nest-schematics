# Writing an add-on generator

Every add-on (`npm run g -- <name>`) follows the same shape so that projects can be
assembled like lego and every generator is safe to re-run.

## Layout

```
src/add-ons/<name>/
  index.ts          # factory: export function <camelName>(options: Schema): Rule
  schema.json       # options (camelCase); add "alias" for one-letter flags
  schema.d.ts       # hand-written interface for schema.json (kept in git)
  files/            # templates (applyTemplates; `.template` suffix for files with <%= %>)
  index_spec.ts     # unit tests against a real starter tree (see "Tests")
scripts/e2e.d/<NN>-<name>.sh   # e2e step, sourced by scripts/e2e.sh
```

Register it in `src/collection.json` (`"factory": "./add-ons/<name>/index#<camelName>"`).

## Rules

1. **Start with `getProject(tree)`** (`src/utils/ops/project.ts`). It fails with a clear
   message outside a generated project and gives you the standard paths.
2. **Check dependencies** with `requireFeatures(tree, '<name>', ['upload'])` and **record**
   yourself at the end with `recordFeature(tree, '<name>', options, item?)`.
3. **Never overwrite user edits.** Merge templates with `mergeSafe(source, options.force)`,
   not `mergeWith(..., MergeStrategy.Overwrite)`. Every schema gets a `force` option.
4. **Edit existing files only through `src/utils/ops`**, which are idempotent:
   - modules: `addModuleImport` (dedupes `X`, `X.forRoot()`), `addModuleProvider`,
     `addModuleController`, `addModuleExport`, `addGlobalProvider(…'APP_GUARD'…)`;
   - imports: `addNamedImports`;
   - `package.json`: `addPackageJson({ dependencies, devDependencies, scripts })`, then
     `scheduleInstall(context, options.skipInstall)`. Every schema gets `skipInstall`;
   - env: `addEnv(tree, { title, vars })` writes `.env.example`, an existing `.env` and
     validators in `env.validation.ts`. New keys must be optional or have working
     defaults, so the project still boots;
   - code blocks in `main.ts`: `insertAtMarker(tree, project.apiMain, MARKERS.bootstrap, code)`;
   - docker: `addComposeService(tree, name, yaml, volumes)`;
   - entity barrel: `addBarrelExport(tree, '<entitiesDir>/index.ts', '<file>')`.
   If you need a new kind of edit, add a helper to `src/utils/ops` with a unit test in
   `ops_spec.ts` rather than string-replacing in your add-on.
5. **Re-running changes nothing.** The e2e runs every step twice and fails on any diff.
6. **Generated code style** follows the starter: NestJS 11, TypeORM 0.3 (Postgres, snake
   case via the naming strategy), class-validator DTOs with explicit `@ApiProperty` types,
   semicolons, single quotes. Admin routes use `@AdminResource`; public client routes are
   explicit. No secrets in code; anything secret comes from env.
7. **Security defaults:** verify every token signature, hash OTPs and refresh tokens, never
   log secrets, rate-limit auth endpoints, no master codes or bypass flags.
8. **Swagger export runs without a database.** `npm run swagger:export` sets
   `SWAGGER_EXPORT=1`, creates the app without initialising it, and writes `openapi/*.json`:
   - the TypeORM DataSource is not connected (`manualInitialization`);
   - `onModuleInit` / `onApplicationBootstrap` never run, so bootstrap DB work (seeding,
     cache warm-up, schedulers) belongs there, never in constructors;
   - any provider or async factory that connects on creation (Redis, queues, SDK clients,
     webhooks registration) must check `isSwaggerExport()` from `@app/common` and skip it
     (return a stub or `null`). From `libs/database` import it as
     `@app/common/swagger/export-mode`;
   - a required env key with no default breaks the export in CI: make keys optional or add a
     throwaway value in `swaggerExportEnvDefaults()`.
9. **OpenAPI contract** (generated clients depend on it):
   - routes go to a document by prefix (`apps/api/src/config/swagger.ts`): `admin/*` and
     `auth/*` → `admin`, the rest → `client`. To route a prefix elsewhere, insert it at the
     `MARKERS.swaggerAdmin` or `MARKERS.swaggerClient` marker, e.g.
     `insertAtMarker(tree, '<apiSrc>/config/swagger.ts', MARKERS.swaggerClient, "'auth/client',")`
     (the longest prefix wins);
   - `operationId` is `<controller><Method>` (`ProductController.findAll` → `productFindAll`):
     controller class names must be unique, handler names are the client's method names;
   - every response has a type: `@ApiOkResponse({ type: Dto })`, pages use
     `@ApiPaginatedResponse(Model)`; an overriding handler loses the base decorators, so repeat them;
   - every enum is named: `@ApiProperty({ ...apiEnum(ProductStatus, 'ProductStatus') })`
     (`swagger:export` lists inline enums);
   - protected routes use `@ApiBearerAuth()` (scheme `bearer`);
   - no `*/` in descriptions (generators copy them into code comments).

## Tests

- Unit: use `src/testing/starter-tree.ts`:
  ```ts
  const runner = createRunner();
  const tree = await createStarterTree(runner);              // project at the tree root
  const out = await runner.runSchematic('<name>', { skipInstall: true }, tree);
  const again = await runner.runSchematic('<name>', { skipInstall: true }, out);
  expect(snapshot(again)).toEqual(snapshot(out));           // idempotent
  ```
  Assert the generated files, module registration, env keys and package.json entries.
- E2E: add `scripts/e2e.d/<NN>-<name>.sh` with `run_g <name> ... --skip-install`. Steps run
  inside the generated project; `scripts/e2e.sh` installs dependencies once afterwards,
  builds, lints, tests, migrates, exports Swagger and boots the API. Smoke requests can be
  appended to `E2E_SMOKE`.

Run locally: `E2E_DB_USER=<pg user> E2E_DB_PASSWORD= scripts/e2e.sh` (needs PostgreSQL).
