# Admin auth is part of the starter (no generator to run). Smoke checks against
# the booted API: the first super admin (ADMIN_EMAIL / ADMIN_PASSWORD from .env)
# signs in, reads `auth/me`, rotates the refresh token, and the old refresh
# token is refused (reuse detection revokes the session). A second smoke covers
# forgot/reset password (token from the mail log), navigation, search and the
# admin's own notifications.
if [ -z "${E2E_RERUN:-}" ]; then
  E2E_SMOKE="${E2E_SMOKE:-}"$'\n''admin_auth_smoke'

  admin_auth_smoke() {
    log "Smoke: admin auth"
    local base="http://localhost:$API_PORT/api" email password body access refresh code
    email="$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)"
    password="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
    json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s)$1;process.stdout.write(v===undefined?'':String(v))})"; }

    body=$(curl -fsS -X POST "$base/auth/sign-in" -H 'content-type: application/json' -H 'x-device-id: e2e' \
      -d "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$email" "$password")") \
      || fail "admin sign-in failed (is the first super admin created on boot?)"
    access=$(echo "$body" | json '.accessToken')
    refresh=$(echo "$body" | json '.refreshToken')
    [ -n "$access" ] && [ -n "$refresh" ] || fail "sign-in response has no tokens: $body"
    [ "$(echo "$body" | json '.user.permissions.includes("*")')" = "true" ] || fail "first admin is not super: $body"

    curl -fsS "$base/auth/me" -H "authorization: Bearer $access" | grep -q "\"email\":\"$email\"" \
      || fail "GET auth/me did not return the admin"

    body=$(curl -fsS -X POST "$base/auth/refresh" -H 'content-type: application/json' -d "{\"refreshToken\":\"$refresh\"}") \
      || fail "refresh failed"
    [ "$(echo "$body" | json '.refreshToken')" != "$refresh" ] || fail "refresh token was not rotated"
    curl -fsS "$base/auth/me" -H "authorization: Bearer $(echo "$body" | json '.accessToken')" >/dev/null \
      || fail "the refreshed access token is refused"

    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/auth/refresh" -H 'content-type: application/json' \
      -d "{\"refreshToken\":\"$refresh\"}")
    [ "$code" = "401" ] || fail "reusing an old refresh token returned $code, expected 401"

    code=$(curl -s -o /dev/null -w '%{http_code}' "$base/admin/admins" -H "authorization: Bearer $access")
    [ "$code" = "401" ] || fail "the session was not revoked after refresh-token reuse ($code)"
    log "Admin auth OK"
  }

  E2E_SMOKE="${E2E_SMOKE:-}"$'\n''admin_portal_smoke'

  # Forgot / reset password, navigation, search and the admin's own notifications.
  # The reset token is read from the mail add-on's log transport (51-mail.sh):
  # the database only has its sha256.
  admin_portal_smoke() {
    log "Smoke: admin forgot/reset password, navigation, search, notifications"
    local base="http://localhost:$API_PORT/api" email password super_access limited_email limited_password role_id limited_id
    local access refresh token tries notification_id token_hash
    local AP_STATUS=""
    ap_json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s)$1;process.stdout.write(v===undefined?'':String(v))})"; }
    ap_obj() { node -e 'const a=process.argv.slice(1),o={};for(let i=0;i<a.length;i+=2){let v=a[i+1];if(v.startsWith("json:"))v=JSON.parse(v.slice(5));o[a[i]]=v}process.stdout.write(JSON.stringify(o))' "$@"; }
    ap_psql() { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc "$1"; }
    # ap_call METHOD PATH [BODY] [TOKEN]: body in $WORK/ap.txt, status in AP_STATUS.
    ap_call() {
      local args=(-s -o "$WORK/ap.txt" -w '%{http_code}' -X "$1" "$base/$2" -H 'content-type: application/json')
      [ -n "${3:-}" ] && args+=(-d "$3")
      [ -n "${4:-}" ] && args+=(-H "authorization: Bearer $4")
      AP_STATUS=$(curl "${args[@]}")
    }
    ap_expect() { [ "$AP_STATUS" = "$1" ] || { cat "$WORK/ap.txt"; echo; fail "$2: got HTTP $AP_STATUS, expected $1"; }; }

    email="$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)"
    password="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
    ap_call POST auth/sign-in "$(ap_obj email "$email" password "$password")"
    ap_expect 200 "super admin sign-in"
    super_access=$(ap_json '.accessToken' <"$WORK/ap.txt")

    # A limited admin: role with admin.read only.
    limited_email="portal-e2e@example.com"; limited_password="FirstPass123"
    ap_call POST admin/roles "$(ap_obj name e2e-portal permissions 'json:["admin.read"]')" "$super_access"
    ap_expect 201 "create role"
    role_id=$(ap_json '.id' <"$WORK/ap.txt")
    ap_call POST admin/admins "$(ap_obj email "$limited_email" name 'Portal E2E' password "$limited_password" roleId "$role_id")" "$super_access"
    ap_expect 201 "create admin"
    limited_id=$(ap_json '.id' <"$WORK/ap.txt")
    ap_call POST auth/sign-in "$(ap_obj email "$limited_email" password "$limited_password")"
    ap_expect 200 "limited sign-in"
    access=$(ap_json '.accessToken' <"$WORK/ap.txt")
    refresh=$(ap_json '.refreshToken' <"$WORK/ap.txt")

    # ── navigation: filtered by permission ──────────────────────────────
    ap_call GET navigation "" ""
    ap_expect 401 "navigation without a token"
    ap_call GET navigation "" "$access"
    ap_expect 200 "navigation (limited)"
    [ "$(ap_json '.default.map(i=>i.id).join()' <"$WORK/ap.txt")" = "admins" ] || fail "limited navigation: $(cat "$WORK/ap.txt")"
    [ "$(ap_json '.horizontal.length' <"$WORK/ap.txt")" = "1" ] || fail "navigation variants: $(cat "$WORK/ap.txt")"
    ap_call GET navigation "" "$super_access"
    ap_expect 200 "navigation (super)"
    [ "$(ap_json '.default.map(i=>i.id).includes("roles")' <"$WORK/ap.txt")" = "true" ] || fail "super navigation lacks roles: $(cat "$WORK/ap.txt")"

    # ── search: each group needs its permission ─────────────────────────
    ap_call POST search "$(ap_obj query portal-e2e)" ""
    ap_expect 401 "search without a token"
    ap_call POST search "$(ap_obj query portal-e2e)" "$access"
    ap_expect 200 "search admins (limited)"
    [ "$(ap_json '.map(g=>g.id).join()' <"$WORK/ap.txt")" = "admins" ] || fail "limited search groups: $(cat "$WORK/ap.txt")"
    [ "$(ap_json '[0].results[0].value' <"$WORK/ap.txt")" = "$limited_email" ] || fail "search hit: $(cat "$WORK/ap.txt")"
    ap_call POST search "$(ap_obj query e2e-portal)" "$access"
    ap_expect 200 "search a role name (limited)"
    [ "$(ap_json '.length' <"$WORK/ap.txt")" = "0" ] || fail "limited admin found a role without role.read: $(cat "$WORK/ap.txt")"
    ap_call POST search "$(ap_obj query e2e-portal)" "$super_access"
    ap_expect 200 "search a role name (super)"
    [ "$(ap_json '.map(g=>g.id).includes("roles")' <"$WORK/ap.txt")" = "true" ] || fail "super search lacks roles: $(cat "$WORK/ap.txt")"
    ap_call POST search "$(ap_obj query '%%')" "$super_access"
    ap_expect 200 "search with a wildcard"
    [ "$(ap_json '.length' <"$WORK/ap.txt")" = "0" ] || fail "'%%' matched everything (LIKE not escaped): $(cat "$WORK/ap.txt")"

    # ── own notifications ───────────────────────────────────────────────
    ap_psql "INSERT INTO admin_notifications (admin_id, title, link) VALUES ('$limited_id', 'Welcome', '/admins')" >/dev/null
    ap_call GET admin/me/notifications "" "$access"
    ap_expect 200 "my notifications"
    [ "$(ap_json '.length' <"$WORK/ap.txt")" = "1" ] && [ "$(ap_json '[0].read' <"$WORK/ap.txt")" = "false" ] || fail "notifications: $(cat "$WORK/ap.txt")"
    notification_id=$(ap_json '[0].id' <"$WORK/ap.txt")
    ap_call POST "admin/me/notifications/$notification_id/read" "" "$super_access"
    ap_expect 404 "marking someone else's notification"
    ap_call POST "admin/me/notifications/$notification_id/read" "" "$access"
    ap_expect 200 "mark read"
    [ "$(ap_json '.read' <"$WORK/ap.txt")" = "true" ] || fail "mark read: $(cat "$WORK/ap.txt")"
    ap_call GET admin/me/notifications "" "$super_access"
    [ "$(ap_json '.length' <"$WORK/ap.txt")" = "0" ] || fail "an admin sees another admin's notifications"

    # ── forgot password ─────────────────────────────────────────────────
    ap_call POST auth/forgot-password "$(ap_obj email nobody-here@example.com)"
    ap_expect 204 "forgot for an unknown email"
    [ ! -s "$WORK/ap.txt" ] || fail "forgot (unknown) has a body: $(cat "$WORK/ap.txt")"
    ap_call POST auth/forgot-password "$(ap_obj email not-an-email)"
    ap_expect 400 "forgot with an invalid email"
    ap_call POST auth/forgot-password "$(ap_obj email "$limited_email")"
    ap_expect 204 "forgot for a known email"
    [ ! -s "$WORK/ap.txt" ] || fail "forgot (known) has a body: $(cat "$WORK/ap.txt")"
    [ "$(ap_psql "SELECT count(*) FROM admin_password_resets WHERE admin_id = '$limited_id'")" = "1" ] || fail "no reset row for the admin"

    token=""
    for tries in $(seq 1 40); do
      token=$(grep -A12 "Email to $limited_email" "$WORK/api.log" | grep -o 'reset-password?token=[A-Za-z0-9_-]*' | tail -1 | cut -d= -f2 || true)
      [ -n "$token" ] && break
      sleep 0.25
    done
    [ -n "$token" ] || { tail -30 "$WORK/api.log"; fail "no reset link for $limited_email in the server log"; }
    [ "$(ap_psql "SELECT count(*) FROM admin_password_resets WHERE token_hash = '$token'")" = "0" ] || fail "reset token stored in plain text"
    token_hash=$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$token")
    [ "$(ap_psql "SELECT count(*) FROM admin_password_resets WHERE token_hash = '$token_hash' AND used_at IS NULL AND expires_at > now() AND expires_at < now() + interval '31 minutes'")" = "1" ] \
      || fail "stored token hash or expiry is wrong"

    # ── reset password ──────────────────────────────────────────────────
    ap_call POST auth/reset-password "$(ap_obj token "$token" password short)"
    ap_expect 400 "reset with a weak password"
    ap_call POST auth/reset-password "$(ap_obj token not-a-real-token password SecondPass123)"
    ap_expect 400 "reset with an unknown token"
    ap_call GET auth/me "" "$access"
    ap_expect 200 "old session before the reset"
    ap_call POST auth/reset-password "$(ap_obj token "$token" password SecondPass123)"
    ap_expect 204 "reset password"
    ap_call POST auth/reset-password "$(ap_obj token "$token" password ThirdPass123)"
    ap_expect 400 "reusing the reset token"
    ap_call GET auth/me "" "$access"
    ap_expect 401 "the old access token after the reset"
    ap_call POST auth/refresh "$(ap_obj refreshToken "$refresh")"
    ap_expect 401 "the old refresh token after the reset"
    ap_call POST auth/sign-in "$(ap_obj email "$limited_email" password "$limited_password")"
    ap_expect 401 "sign-in with the old password"
    ap_call POST auth/sign-in "$(ap_obj email "$limited_email" password SecondPass123)"
    ap_expect 200 "sign-in with the new password"

    # The hand-written migration matches the entities (no schema diff for the new tables).
    npm run --silent typeorm -- schema:log -d libs/database/src/data-source.ts >"$WORK/portal-schema.log" 2>&1 ||
      { cat "$WORK/portal-schema.log"; fail "typeorm schema:log failed."; }
    if grep -E '"(admin_password_resets|admin_notifications)"' "$WORK/portal-schema.log"; then
      fail "admin_password_resets / admin_notifications differ from their migration (see above)."
    fi

    # Leave no trace for the next smokes.
    ap_call DELETE "admin/admins/$limited_id" "" "$super_access"
    ap_expect 200 "delete the e2e admin"
    ap_call DELETE "admin/roles/$role_id" "" "$super_access"
    ap_expect 200 "delete the e2e role"
    log "Admin portal OK"
  }
fi
