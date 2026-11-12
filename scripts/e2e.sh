#!/usr/bin/env bash
# End-to-end check: pack the package, generate a project with it, add CRUD
# resources and every add-on step in scripts/e2e.d/*.sh, then install, build,
# lint, test, migrate, export Swagger and boot the API against PostgreSQL.
#
#   scripts/e2e.sh                 # work dir under $TMPDIR, removed on success
#   E2E_KEEP=1 scripts/e2e.sh      # keep the generated project
#
# Database (a fresh database is created and dropped):
#   E2E_DB_HOST=localhost E2E_DB_PORT=5432 E2E_DB_USER=postgres E2E_DB_PASSWORD=postgres
#
# Add-on steps: each file in scripts/e2e.d/ is sourced in name order inside the
# project directory. Use `run_g <args>` to call a generator and `check` helpers
# below; keep each add-on in its own file so parallel work does not collide.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${E2E_WORK:-$(mktemp -d "${TMPDIR:-/tmp}/nest-schematics-e2e.XXXXXX")}"
DB_HOST="${E2E_DB_HOST:-localhost}"
DB_PORT="${E2E_DB_PORT:-5432}"
DB_USER="${E2E_DB_USER:-${PGUSER:-postgres}}"
DB_PASSWORD="${E2E_DB_PASSWORD-postgres}"
DB_NAME="ns_e2e_$(date +%s)_$$"
API_PORT="${E2E_API_PORT:-3917}"
API_PID=""

log() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
has_script() { node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)"; }
run_g() { log "g $*"; npm run --silent g -- "$@"; }
psql_admin() { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -qc "$1"; }

cleanup() {
  if [ -n "$API_PID" ]; then kill "$API_PID" 2>/dev/null || true; wait "$API_PID" 2>/dev/null || true; fi
  psql_admin "DROP DATABASE IF EXISTS \"$DB_NAME\"" 2>/dev/null || true
  if [ "${E2E_KEEP:-}" = "1" ] || [ "${1:-}" != "0" ]; then
    echo "Project kept at: $WORK/shop"
  else
    rm -rf "$WORK"
  fi
}
trap 'code=$?; cleanup $code; exit $code' EXIT

log "Build and pack nest-schematics"
cd "$ROOT"
npm run build >/dev/null
TGZ="$WORK/$(npm pack --silent --pack-destination "$WORK" | tail -1)"

log "Generate project"
cd "$WORK"
npm exec --yes --package="$TGZ" -- nest-schematics new shop --skip-install
cd shop
# The package is not published yet in CI: point the project at the tarball.
node -e "const p=require('./package.json');p.devDependencies['nest-schematics']='file:$TGZ';require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"

log "npm install"
npm install --no-audit --no-fund --loglevel=error

log "Database $DB_NAME"
psql_admin "CREATE DATABASE \"$DB_NAME\""
cp .env.example .env
node - "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASSWORD" "$DB_NAME" "$API_PORT" <<'NODE'
const fs = require('fs');
const [host, port, user, password, db, apiPort] = process.argv.slice(2);
const set = { DB_HOST: host, DB_PORT: port, DB_USERNAME: user, DB_PASSWORD: password, DB_DATABASE: db, PORT: apiPort };
let env = fs.readFileSync('.env', 'utf8');
for (const [k, v] of Object.entries(set)) env = env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);
fs.writeFileSync('.env', env);
NODE

git init -q && git add -A && git -c user.email=e2e@local -c user.name=e2e commit -qm starter

log "CRUD resources"
run_g crud category --fields "name:string,active:boolean"
run_g crud product --fields "name:string,description:text?,price:number,status:enum(draft|published),publishedAt:date?"

for step in "$ROOT"/scripts/e2e.d/*.sh; do
  [ -e "$step" ] || continue
  log "Add-on step: $(basename "$step")"
  # shellcheck source=/dev/null
  source "$step"
done

if [ -n "$(node -p "Object.keys(require('./package.json').dependencies).join()" )" ]; then
  log "npm install (add-on dependencies)"
  npm install --no-audit --no-fund --loglevel=error
fi
git add -A && git -c user.email=e2e@local -c user.name=e2e commit -qm generated

log "Re-run every generator: nothing may change"
run_g crud category --fields "name:string,active:boolean"
run_g crud product --fields "name:string,description:text?,price:number,status:enum(draft|published),publishedAt:date?"
E2E_RERUN=1
for step in "$ROOT"/scripts/e2e.d/*.sh; do
  [ -e "$step" ] || continue
  # shellcheck source=/dev/null
  source "$step"
done
git add -A
git diff --cached --quiet || { git diff --cached --stat; fail "A re-run changed files (generators must be idempotent)."; }

log "Build"
npm run build

if has_script lint; then log "Lint"; npm run lint; fi
if has_script test; then log "Unit tests"; npm test -- --passWithNoTests; fi
if has_script migration:run; then
  if [ -d libs/database/src/migrations ] && ls libs/database/src/migrations/*.ts >/dev/null 2>&1; then
    log "Migrations"; npm run migration:run
  fi
fi
if has_script swagger:export; then log "Swagger export"; npm run swagger:export; fi

log "Boot the API"
if curl -s "http://localhost:$API_PORT" >/dev/null 2>&1; then fail "Port $API_PORT is already in use (set E2E_API_PORT)."; fi
node dist/apps/api/main >"$WORK/api.log" 2>&1 &
API_PID=$!
HEALTH_URL="http://localhost:$API_PORT/api"
for _ in $(seq 1 40); do
  if curl -fsS "http://localhost:$API_PORT/api/health" >/dev/null 2>&1; then HEALTH_URL="http://localhost:$API_PORT/api/health"; break; fi
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then break; fi
  kill -0 "$API_PID" 2>/dev/null || { cat "$WORK/api.log"; fail "API exited during startup."; }
  sleep 0.5
done
curl -fsS "$HEALTH_URL" >/dev/null || { cat "$WORK/api.log"; fail "API did not answer at $HEALTH_URL."; }
code=$(curl -s -o "$WORK/resp.txt" -w '%{http_code}' "http://localhost:$API_PORT/api/admin/product")
[ "$code" = "401" ] || { cat "$WORK/api.log" "$WORK/resp.txt"; fail "GET /api/admin/product without a token returned $code, expected 401."; }
if [ -n "${E2E_SMOKE:-}" ]; then eval "$E2E_SMOKE"; fi

log "E2E passed"
