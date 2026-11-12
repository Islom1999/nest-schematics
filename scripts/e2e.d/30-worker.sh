# apps/worker (cron). Smoke: the built worker boots and its heartbeat reaches the database.
run_g worker --skip-install

worker_smoke() {
  log "worker: boot dist/apps/worker/main"
  [ -f dist/apps/worker/main.js ] || fail "dist/apps/worker/main.js missing (npm run build must build the worker)."
  node dist/apps/worker/main >"$WORK/worker.log" 2>&1 &
  local pid=$!
  for _ in $(seq 1 30); do
    grep -q 'heartbeat: database reachable' "$WORK/worker.log" && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  grep -q 'heartbeat: database reachable' "$WORK/worker.log" || { cat "$WORK/worker.log"; fail "worker did not run its heartbeat."; }
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'worker_smoke; fi
