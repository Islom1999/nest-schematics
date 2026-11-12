# Queue: BullMQ (needs redis). Runs before 30-worker, so the worker step moves
# the processors from the api to apps/worker (deferred wiring). Without
# REDIS_URL the in-memory driver is used; BullMQ itself is covered by the
# generated jest specs (mocked bullmq).
run_g queue --skip-install

queue_smoke() {
  log "Smoke: queue (in-memory driver)"
  local base="http://localhost:$API_PORT/api" email password access code
  email="$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)"
  password="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
  access=$(curl -fsS -X POST "$base/auth/sign-in" -H 'content-type: application/json' -H 'x-device-id: e2e-queue' \
    -d "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$email" "$password")" |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).accessToken||''))") ||
    fail "queue: admin sign-in failed"
  code=$(curl -s -o "$WORK/queues.json" -w '%{http_code}' "$base/admin/queues" -H "authorization: Bearer $access")
  [ "$code" = "200" ] || { cat "$WORK/queues.json"; fail "GET admin/queues returned $code, expected 200."; }
  grep -q '"driver":"memory"' "$WORK/queues.json" || { cat "$WORK/queues.json"; fail "admin/queues: expected the memory driver."; }
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base/admin/queues")
  [ "$code" = "401" ] || fail "GET admin/queues without a token returned $code, expected 401."
  grep -q 'in-memory job queue' "$WORK/api.log" || { tail -30 "$WORK/api.log"; fail "queue: no in-memory warning in the API log."; }
  log "queue OK"
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'queue_smoke; fi
