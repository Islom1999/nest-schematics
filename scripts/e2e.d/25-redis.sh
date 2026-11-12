# Redis: ioredis client, shared CacheStore, Redis throttler storage, health check.
# CI has no Redis server: REDIS_URL is blanked in .env, so the API must boot on
# the in-memory fallbacks and say so in its log. The Redis code paths are
# covered by the generated jest specs (ioredis-mock).
run_g redis --skip-install

# addEnv wrote REDIS_URL=redis://localhost:6379 into .env: switch to the fallback.
node -e "const fs=require('fs');fs.writeFileSync('.env',fs.readFileSync('.env','utf8').replace(/^REDIS_URL=.*$/m,'REDIS_URL='))"

redis_smoke() {
  log "Smoke: redis (in-memory fallback)"
  local base="http://localhost:$API_PORT/api" code
  grep -q 'REDIS_URL is not set' "$WORK/api.log" || { tail -30 "$WORK/api.log"; fail "redis: no in-memory fallback warning in the API log."; }
  code=$(curl -s -o "$WORK/redis-health.json" -w '%{http_code}' "$base/health/ready")
  [ "$code" = "200" ] || { cat "$WORK/redis-health.json"; fail "GET health/ready returned $code, expected 200."; }
  grep -q '"redis":{"status":"up","mode":"memory"}' "$WORK/redis-health.json" ||
    { cat "$WORK/redis-health.json"; fail "health/ready does not report redis in memory mode."; }
  log "redis OK"
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'redis_smoke; fi
