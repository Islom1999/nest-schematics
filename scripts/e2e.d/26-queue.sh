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

  # ── jobs, retry, clean, pause, resume (memory driver; BullMQ is covered by the jest specs) ──
  q_call() { # METHOD PATH [BODY] [TOKEN]
    local args=(-s -o "$WORK/q.json" -w '%{http_code}' -X "$1" "$base/$2" -H 'content-type: application/json')
    [ -n "${3:-}" ] && args+=(-d "$3")
    [ -n "${4-$access}" ] && args+=(-H "authorization: Bearer ${4-$access}")
    code=$(curl "${args[@]}")
  }
  q_expect() { [ "$code" = "$1" ] || { cat "$WORK/q.json"; echo; fail "queue: $2: got HTTP $code, expected $1"; }; }
  q_call GET "admin/queues/default/jobs?status=failed"
  q_expect 200 "GET queues/default/jobs"
  grep -q '"count":0' "$WORK/q.json" && grep -q '"data":\[\]' "$WORK/q.json" || fail "queue: empty job list expected: $(cat "$WORK/q.json")"
  q_call GET "admin/queues/default/jobs?status=bogus"
  q_expect 400 "invalid status"
  q_call GET "admin/queues/nope/jobs?status=failed"
  q_expect 404 "unknown queue"
  q_call POST admin/queues/default/jobs/missing/retry
  q_expect 404 "retry of an unknown job"
  q_call POST admin/queues/default/clean '{"status":"completed","olderThanMs":0}'
  q_expect 200 "clean"
  grep -q '"removed":0' "$WORK/q.json" || fail "queue: clean result: $(cat "$WORK/q.json")"
  q_call POST admin/queues/default/clean '{"status":"active","olderThanMs":0}'
  q_expect 400 "active jobs cannot be cleaned"
  q_call POST admin/queues/default/pause
  q_expect 200 "pause"
  q_call GET admin/queues
  grep -q '"paused":true' "$WORK/q.json" || fail "queue: default is not paused: $(cat "$WORK/q.json")"
  q_call POST admin/queues/default/resume
  q_expect 200 "resume"
  q_call GET admin/queues
  grep -q '"paused":false' "$WORK/q.json" || fail "queue: default is still paused: $(cat "$WORK/q.json")"
  q_call POST admin/queues/default/pause "" ""
  q_expect 401 "pause without a token"
  log "queue OK"
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'queue_smoke; fi
