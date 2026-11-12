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
    [ -f dist/apps/api/modules/ai/chat/prompts/default.md ] || fail "ai: chat prompts were not copied to dist."
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/client/ai/chat/stream" -H 'content-type: application/json' -d '{"message":"hi"}')
    [ "$code" = "401" ] || fail "POST client/ai/chat/stream without a token returned $code, expected 401."
  else
    log "ai: chat smoke skipped (no auth-client)"
  fi
  log "ai OK"
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'ai_smoke; fi
