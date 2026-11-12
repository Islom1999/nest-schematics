# Settings: app_settings + admin CRUD + public settings + maintenance mode.
# Smoke: CRUD by id and by key, public settings, maintenance on (client route
# 503 with the message, admin and health still 200) and off again, and the
# hand-written migration matches the entity (schema:log shows nothing).
run_g settings --skip-install

settings_smoke() {
  log "Smoke: settings"
  local base="http://localhost:$API_PORT/api" email password access id code
  local ST_STATUS=""
  st_json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s)$1;process.stdout.write(v===undefined?'':typeof v==='string'?v:JSON.stringify(v))})"; }
  # st_call METHOD PATH [BODY] [TOKEN]: response in $WORK/st.txt, status in ST_STATUS.
  st_call() {
    local args=(-s -o "$WORK/st.txt" -w '%{http_code}' -X "$1" "$base/$2" -H 'content-type: application/json')
    [ -n "${3:-}" ] && args+=(-d "$3")
    [ -n "${4:-}" ] && args+=(-H "authorization: Bearer $4")
    ST_STATUS=$(curl "${args[@]}")
  }
  st_has_feature() { node -e "process.exit(require('./nest-schematics.json').features?.['$1'] ? 0 : 1)"; }
  st_expect() { [ "$ST_STATUS" = "$1" ] || { cat "$WORK/st.txt"; echo; fail "$2: got HTTP $ST_STATUS, expected $1"; }; }

  email="$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)"
  password="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
  st_call POST auth/sign-in "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$email" "$password")"
  st_expect 200 "admin sign-in"
  access=$(st_json '.accessToken' <"$WORK/st.txt")

  # ── CRUD ─────────────────────────────────────────────────────────────
  st_call GET admin/settings "" ""
  st_expect 401 "admin/settings without a token"
  st_call POST admin/settings '{"key":"support_phone","value":"+998901234567","isPublic":true,"description":"Support"}' "$access"
  st_expect 201 "create a setting"
  id=$(st_json '.id' <"$WORK/st.txt")
  st_call POST admin/settings '{"key":"support_phone","value":"x"}' "$access"
  st_expect 409 "duplicate key"
  st_call POST admin/settings '{"key":"flags","value":{"beta":true}}' "$access"
  st_expect 201 "create a private setting"
  st_call PUT "admin/settings/$id" '{"value":"+998900000000"}' "$access"
  st_expect 200 "update by id"
  st_call GET admin/settings/key/flags "" "$access"
  st_expect 200 "GET by key"
  [ "$(st_json '.value.beta' <"$WORK/st.txt")" = "true" ] || fail "GET by key: $(cat "$WORK/st.txt")"
  st_call POST admin/settings/pagination '{"first":0,"rows":10}' "$access"
  st_expect 200 "pagination"
  [ "$(st_json '.count >= 3' <"$WORK/st.txt")" = "true" ] || fail "pagination: $(cat "$WORK/st.txt")"
  st_call PUT admin/settings/key/maintenance '{"value":{"enabled":"yes"}}' "$access"
  st_expect 400 "malformed maintenance value"

  # ── public ───────────────────────────────────────────────────────────
  st_call GET settings/public
  st_expect 200 "GET settings/public"
  [ "$(st_json '.support_phone' <"$WORK/st.txt")" = "+998900000000" ] || fail "public settings (updated value): $(cat "$WORK/st.txt")"
  [ "$(st_json '.maintenance.enabled' <"$WORK/st.txt")" = "false" ] || fail "public settings (maintenance row): $(cat "$WORK/st.txt")"
  [ -z "$(st_json '.flags' <"$WORK/st.txt")" ] || fail "a private setting is public: $(cat "$WORK/st.txt")"

  # ── maintenance on ───────────────────────────────────────────────────
  st_call PUT admin/settings/key/maintenance '{"value":{"enabled":true,"message":"Back at 10:00"}}' "$access"
  st_expect 200 "maintenance on"
  st_call GET admin/product "" ""
  st_expect 401 "admin route without a token during maintenance"
  st_call POST admin/product/pagination '{"first":0,"rows":5}' "$access"
  st_expect 200 "admin route during maintenance"
  st_call GET health
  st_expect 200 "health during maintenance"
  st_call GET settings/public
  st_expect 200 "public settings during maintenance"
  # Client routes of the add-ons in this run (auth-client, upload); at least one must exist.
  local client_routes=() route
  if st_has_feature auth-client; then client_routes+=(client/auth/me); fi
  if st_has_feature upload; then client_routes+=(files/00000000-0000-0000-0000-000000000000); fi
  [ "${#client_routes[@]}" -gt 0 ] || fail "settings: no client route to test maintenance with (needs auth-client or upload)."
  for route in "${client_routes[@]}"; do
    st_call GET "$route"
    st_expect 503 "client route $route during maintenance"
    grep -q '"message":"Back at 10:00"' "$WORK/st.txt" || fail "maintenance message missing: $(cat "$WORK/st.txt")"
    grep -q '"code":"MAINTENANCE"' "$WORK/st.txt" || fail "maintenance code missing: $(cat "$WORK/st.txt")"
  done

  # ── maintenance off ──────────────────────────────────────────────────
  st_call PUT admin/settings/key/maintenance '{"value":{"enabled":false,"message":""}}' "$access"
  st_expect 200 "maintenance off"
  for route in "${client_routes[@]}"; do
    st_call GET "$route"
    [ "$ST_STATUS" != "503" ] || { cat "$WORK/st.txt"; fail "client route $route still 503 after maintenance off"; }
  done

  st_call DELETE "admin/settings/$id" "" "$access"
  st_expect 200 "delete"
  st_call GET settings/public
  [ -z "$(st_json '.support_phone' <"$WORK/st.txt")" ] || fail "deleted setting still public: $(cat "$WORK/st.txt")"

  # The hand-written migration must match the entity exactly.
  npm run --silent typeorm -- schema:log -d libs/database/src/data-source.ts >"$WORK/settings-schema.log" 2>&1 ||
    { cat "$WORK/settings-schema.log"; fail "typeorm schema:log failed."; }
  if grep -E '"app_settings"' "$WORK/settings-schema.log"; then fail "app_settings differs from its migration (see above)."; fi
  log "settings OK"
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'settings_smoke; fi
