# AI: AiService over OpenRouter + Gemini (fetch only), ai_logs and admin stats.
# --chat/--quota need auth-client: they run only when the manifest has it.
# No real AI calls: the keys stay empty, so generate must answer 503 AI_NOT_CONFIGURED.
run_g ai openrouter --skip-install
run_g ai gemini --skip-install

AI_CHAT=""
if node -e "process.exit(require('./nest-schematics.json').features?.['auth-client'] ? 0 : 1)"; then
  run_g ai openrouter --chat --quota --skip-install
  AI_CHAT=1
elif [ -z "${E2E_RERUN:-}" ]; then
  log "ai: auth-client is not installed, skipping the --chat --quota part (run it after auth-client is merged)"
fi

# GET admin/ai/usage over rows written straight into the quota tables.
ai_usage_smoke() {
  local base="$1" access="$2" code uid="e2e-ai-usage-$$"
  ai_psql() { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc "$1"; }
  ai_psql "INSERT INTO ai_usage_daily (user_id, day, messages, tokens) VALUES ('$uid', (now() AT TIME ZONE 'utc')::date, 3, 900), ('$uid', (now() AT TIME ZONE 'utc')::date - 1, 2, 400)" >/dev/null
  ai_psql "INSERT INTO ai_usage_monthly (user_id, month, messages, tokens) VALUES ('$uid', date_trunc('month', now() AT TIME ZONE 'utc')::date, 5, 1300)" >/dev/null

  code=$(curl -s -o "$WORK/ai-usage.json" -w '%{http_code}' "$base/admin/ai/usage?userId=$uid" -H "authorization: Bearer $access")
  [ "$code" = "200" ] || { cat "$WORK/ai-usage.json"; ai_psql "DELETE FROM ai_usage_daily WHERE user_id = '$uid'; DELETE FROM ai_usage_monthly WHERE user_id = '$uid'" >/dev/null; fail "GET admin/ai/usage returned $code, expected 200."; }
  node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    const ok = r.userId===process.argv[2] && r.daily.length===2 && r.daily[0].messages===3 && r.daily[0].tokens===900
      && r.monthly.length===1 && r.monthly[0].tokens===1300 && /^\d{4}-\d{2}$/.test(r.monthly[0].month)
      && r.totals.dailyMessages===5 && r.totals.dailyTokens===1300 && r.totals.dailyUsers===1 && r.totals.monthlyTokens===1300
      && r.current && r.current.dailyMessages===3 && r.current.monthlyTokens===1300 && typeof r.current.dailyMessageLimit==='number';
    process.exit(ok ? 0 : 1)" "$WORK/ai-usage.json" "$uid" || { cat "$WORK/ai-usage.json"; fail "admin/ai/usage returned the wrong numbers."; }

  # A window that ends before the rows: nothing for this user, but the route still answers.
  code=$(curl -s -o "$WORK/ai-usage-old.json" -w '%{http_code}' "$base/admin/ai/usage?userId=$uid&from=2020-01-01&to=2020-01-31" -H "authorization: Bearer $access")
  [ "$code" = "200" ] && grep -q '"daily":\[\]' "$WORK/ai-usage-old.json" || { cat "$WORK/ai-usage-old.json"; fail "admin/ai/usage for an old window should be empty (HTTP $code)."; }
  ai_psql "DELETE FROM ai_usage_daily WHERE user_id = '$uid'; DELETE FROM ai_usage_monthly WHERE user_id = '$uid'" >/dev/null

  code=$(curl -s -o /dev/null -w '%{http_code}' "$base/admin/ai/usage?from=2026-02-01&to=2026-01-01" -H "authorization: Bearer $access")
  [ "$code" = "400" ] || fail "GET admin/ai/usage with from after to returned $code, expected 400."
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base/admin/ai/usage")
  [ "$code" = "401" ] || fail "GET admin/ai/usage without a token returned $code, expected 401."
}

ai_smoke() {
  log "Smoke: ai"
  local base="http://localhost:$API_PORT/api" email password access code body
  email="$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)"
  password="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
  access=$(curl -fsS -X POST "$base/auth/sign-in" -H 'content-type: application/json' -H 'x-device-id: e2e-ai' \
    -d "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$email" "$password")" |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).accessToken||''))") ||
    fail "ai: admin sign-in failed"
  [ -n "$access" ] || fail "ai: admin sign-in returned no access token"

  code=$(curl -s -o "$WORK/ai-stats.json" -w '%{http_code}' "$base/admin/ai/stats?days=7" -H "authorization: Bearer $access")
  [ "$code" = "200" ] || { cat "$WORK/ai-stats.json"; fail "GET admin/ai/stats returned $code, expected 200."; }
  grep -q '"totals"' "$WORK/ai-stats.json" || { cat "$WORK/ai-stats.json"; fail "admin/ai/stats has no totals."; }
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base/admin/ai/stats")
  [ "$code" = "401" ] || fail "GET admin/ai/stats without a token returned $code, expected 401."
  # ?days= keeps working and now also carries from, to and a cost per day (every day present).
  node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    const ok = Array.isArray(r.byDay) && Array.isArray(r.costByDay) && r.costByDay.length >= 7 && r.costByDay.every((d)=>typeof d.costUsd==='number') && r.from && r.to && r.since;
    process.exit(ok ? 0 : 1)" "$WORK/ai-stats.json" || { cat "$WORK/ai-stats.json"; fail "admin/ai/stats?days=7 has no costByDay/from/to."; }
  code=$(curl -s -o "$WORK/ai-stats-range.json" -w '%{http_code}' "$base/admin/ai/stats?from=2026-01-01&to=2026-01-10" -H "authorization: Bearer $access")
  [ "$code" = "200" ] || { cat "$WORK/ai-stats-range.json"; fail "GET admin/ai/stats?from&to returned $code, expected 200."; }
  node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    const ok = r.from==='2026-01-01' && r.to==='2026-01-10' && r.costByDay.length===10 && r.costByDay[0].day==='2026-01-01' && r.costByDay[9].day==='2026-01-10' && r.since.startsWith('2026-01-01T00:00:00');
    process.exit(ok ? 0 : 1)" "$WORK/ai-stats-range.json" || { cat "$WORK/ai-stats-range.json"; fail "admin/ai/stats from/to window is wrong."; }
  for query in 'from=2026-02-01&to=2026-01-01' 'from=nope' 'from=2020-01-01&to=2026-01-01'; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$base/admin/ai/stats?$query" -H "authorization: Bearer $access")
    [ "$code" = "400" ] || fail "GET admin/ai/stats?$query returned $code, expected 400."
  done

  code=$(curl -s -o "$WORK/ai-generate.json" -w '%{http_code}' -X POST "$base/admin/ai/generate" \
    -H "authorization: Bearer $access" -H 'content-type: application/json' -d '{"prompt":"Say hi"}')
  body=$(cat "$WORK/ai-generate.json")
  [ "$code" = "503" ] || { echo "$body"; fail "POST admin/ai/generate without a key returned $code, expected 503."; }
  echo "$body" | grep -q 'AI is not configured: set OPENROUTER_API_KEY' ||
    { echo "$body"; fail "the unconfigured error is not clear: $body"; }

  code=$(curl -s -o "$WORK/ai-logs.json" -w '%{http_code}' -X POST "$base/admin/ai/logs/pagination" \
    -H "authorization: Bearer $access" -H 'content-type: application/json' -d '{"first":0,"rows":10}')
  [ "$code" = "200" ] || [ "$code" = "201" ] || { cat "$WORK/ai-logs.json"; fail "POST admin/ai/logs/pagination returned $code."; }

  # The hand-written migrations must match the entities exactly.
  npm run --silent typeorm -- schema:log -d libs/database/src/data-source.ts >"$WORK/ai-schema.log" 2>&1 ||
    { cat "$WORK/ai-schema.log"; fail "typeorm schema:log failed."; }
  if grep -E '"ai_[a-z_]+"' "$WORK/ai-schema.log"; then fail "ai_* tables differ from their migrations (see above)."; fi

  if [ -n "$AI_CHAT" ]; then
    ai_usage_smoke "$base" "$access"
    [ -f dist/apps/api/modules/ai/chat/prompts/default.md ] || fail "ai: chat prompts were not copied to dist."
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/client/ai/chat/stream" -H 'content-type: application/json' -d '{"message":"hi"}')
    [ "$code" = "401" ] || fail "POST client/ai/chat/stream without a token returned $code, expected 401."
  else
    log "ai: chat smoke skipped (no auth-client)"
  fi
  log "ai OK"
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'ai_smoke; fi
