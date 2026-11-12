# apps/bot (telegraf). Smoke: with an empty BOT_TOKEN the bot app boots and stays disabled.
run_g bot --skip-install

bot_smoke() {
  log "bot: boot dist/apps/bot/main without a token"
  [ -f dist/apps/bot/main.js ] || fail "dist/apps/bot/main.js missing (npm run build must build the bot)."
  BOT_TOKEN= node dist/apps/bot/main >"$WORK/bot.log" 2>&1 &
  local pid=$!
  for _ in $(seq 1 30); do
    grep -q 'Bot app started' "$WORK/bot.log" && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  grep -q 'bot is disabled' "$WORK/bot.log" && grep -q 'Bot app started' "$WORK/bot.log" ||
    { cat "$WORK/bot.log"; fail "bot app did not start in disabled mode."; }
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'bot_smoke; fi
