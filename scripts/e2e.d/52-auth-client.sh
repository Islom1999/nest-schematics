# Client (app user) auth with phone + email sign-in (needs 50-sms and 51-mail).
# Smoke: phone code read from the server log (SMS_PROVIDER=log, never a master
# code), sign-in, me, refresh rotation, reuse revokes the session, email
# sign-up and password reset, sessions with isCurrent, push token, and admin
# and user tokens refused by each other's routes.
run_g auth-client --methods phone,email --skip-install

auth_client_smoke() {
  log "Smoke: client auth"
  local base="http://localhost:$API_PORT/api" phone email body code wrong access refresh access2 refresh2 user_id admin
  local AC_STATUS=""
  ac_json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s)$1;process.stdout.write(v===undefined?'':String(v))})"; }
  # JSON from key/value pairs, so no shell quoting is involved: ac_obj phone +998.. code 123456
  ac_obj() { node -e 'const a=process.argv.slice(1),o={};for(let i=0;i<a.length;i+=2)o[a[i]]=a[i+1];process.stdout.write(JSON.stringify(o))' "$@"; }
  ac_psql() { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc "$1"; }
  # ac_call METHOD PATH [BODY] [TOKEN]: response in $WORK/ac.txt, status in AC_STATUS.
  ac_call() {
    local args=(-s -o "$WORK/ac.txt" -w '%{http_code}' -X "$1" "$base/$2" -H 'content-type: application/json')
    [ -n "${3:-}" ] && args+=(-d "$3")
    [ -n "${4:-}" ] && args+=(-H "authorization: Bearer $4")
    AC_STATUS=$(curl "${args[@]}")
  }
  ac_expect() { [ "$AC_STATUS" = "$1" ] || { cat "$WORK/ac.txt"; echo; fail "$2: got HTTP $AC_STATUS, expected $1"; }; }

  # ── phone: code from the server log ──────────────────────────────────
  phone="+99890$(node -e 'process.stdout.write(String(Math.floor(1e6 + Math.random() * 8.9e6)))')"
  ac_call POST client/auth/phone/send-code "$(ac_obj phone "$phone")"
  ac_expect 200 "send-code"
  grep -q '"expiresIn":180' "$WORK/ac.txt" || fail "send-code response: $(cat "$WORK/ac.txt")"
  code=""
  for _ in $(seq 1 20); do
    code=$(grep "SMS to $phone" "$WORK/api.log" | tail -1 | sed -nE 's/.*code: ([0-9]{6}).*/\1/p')
    [ -n "$code" ] && break
    sleep 0.25
  done
  [ -n "$code" ] || { tail -20 "$WORK/api.log"; fail "no SMS code for $phone in the server log"; }
  if grep -q "$code" "$WORK/ac.txt"; then fail "send-code response contains the code"; fi
  [ "$(ac_psql "SELECT count(*) FROM user_otps WHERE code_hash = '$code'")" = "0" ] || fail "OTP stored in plain text"

  wrong="000000"; [ "$code" = "$wrong" ] && wrong="111111"
  ac_call POST client/auth/phone/verify "$(ac_obj phone "$phone" code "$wrong")"
  ac_expect 401 "verify with a wrong code"
  ac_call POST client/auth/phone/verify "$(ac_obj phone "$phone" code "$code")"
  ac_expect 200 "verify"
  body=$(cat "$WORK/ac.txt")
  access=$(echo "$body" | ac_json '.accessToken')
  refresh=$(echo "$body" | ac_json '.refreshToken')
  user_id=$(echo "$body" | ac_json '.user.id')
  [ "$(echo "$body" | ac_json '.isNew')" = "true" ] || fail "first phone sign-in is not isNew: $body"
  [ "$(echo "$body" | ac_json '.user.accountNo >= 100000')" = "true" ] || fail "accountNo below 100000: $body"
  ac_call POST client/auth/phone/verify "$(ac_obj phone "$phone" code "$code")"
  ac_expect 401 "reusing a used code"

  ac_call GET client/auth/me "" "$access"
  ac_expect 200 "GET client/auth/me"
  grep -q "\"phone\":\"$phone\"" "$WORK/ac.txt" || fail "me: $(cat "$WORK/ac.txt")"

  # ── refresh rotation and reuse detection ─────────────────────────────
  ac_call POST client/auth/refresh "$(ac_obj refreshToken "$refresh")"
  ac_expect 200 "refresh"
  access2=$(ac_json '.accessToken' <"$WORK/ac.txt")
  refresh2=$(ac_json '.refreshToken' <"$WORK/ac.txt")
  [ -n "$refresh2" ] && [ "$refresh2" != "$refresh" ] || fail "refresh token was not rotated"
  ac_call GET client/auth/me "" "$access2"
  ac_expect 200 "me with the refreshed token"
  ac_call POST client/auth/refresh "$(ac_obj refreshToken "$refresh")"
  ac_expect 401 "reusing an old refresh token"
  ac_call GET client/auth/me "" "$access2"
  ac_expect 401 "the session after refresh-token reuse"

  # ── email: sign-up, reset code by email, sign-in ─────────────────────
  email="e2e-$(date +%s)-$$@example.com"
  ac_call POST client/auth/email/sign-up "$(ac_obj email "$email" password FirstPass123 name E2E)"
  ac_expect 200 "email sign-up"
  ac_call POST client/auth/email/sign-up "$(ac_obj email "$email" password FirstPass123)"
  ac_expect 409 "duplicate sign-up"
  ac_call POST client/auth/email/forgot-password "$(ac_obj email "$email")"
  ac_expect 200 "forgot-password"
  code=""
  for _ in $(seq 1 20); do
    code=$(grep -A8 "Email to $email" "$WORK/api.log" | grep -xE '[0-9]{6}' | tail -1 || true)
    [ -n "$code" ] && break
    sleep 0.25
  done
  [ -n "$code" ] || { tail -20 "$WORK/api.log"; fail "no reset code for $email in the server log"; }
  ac_call POST client/auth/email/reset-password "$(ac_obj email "$email" code "$code" newPassword SecondPass123)"
  ac_expect 200 "reset-password"
  ac_call POST client/auth/email/sign-in "$(ac_obj email "$email" password FirstPass123)"
  ac_expect 401 "sign-in with the old password"
  ac_call POST client/auth/email/sign-in "$(ac_obj email "$email" password SecondPass123)"
  ac_expect 200 "sign-in with the new password"
  access=$(ac_json '.accessToken' <"$WORK/ac.txt")

  # ── sessions and push token ──────────────────────────────────────────
  ac_call GET client/auth/sessions "" "$access"
  ac_expect 200 "GET sessions"
  [ "$(ac_json '.filter(s => s.isCurrent).length' <"$WORK/ac.txt")" = "1" ] || fail "sessions: $(cat "$WORK/ac.txt")"
  ac_call PUT client/auth/push-token "$(ac_obj token e2e-push-token platform android)" "$access"
  ac_expect 200 "PUT push-token"
  [ "$(ac_psql "SELECT push_platform FROM user_sessions WHERE push_token = 'e2e-push-token' AND revoked_at IS NULL")" = "android" ] \
    || fail "push token not stored on the session"

  # ── admin vs user tokens ─────────────────────────────────────────────
  ac_call POST auth/sign-in "$(ac_obj email "$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)" password "$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)")"
  ac_expect 200 "admin sign-in"
  admin=$(ac_json '.accessToken' <"$WORK/ac.txt")
  ac_call GET client/auth/me "" "$admin"
  ac_expect 401 "admin token on a client route"
  ac_call GET "admin/users/$user_id" "" "$access"
  ac_expect 401 "user token on an admin route"
  ac_call GET "admin/users/$user_id" "" "$admin"
  ac_expect 200 "GET admin/users/:id"
  ac_call POST admin/users/pagination '{"first":0,"rows":10}' "$admin"
  ac_expect 200 "admin users pagination"
  [ "$(ac_json '.count >= 2' <"$WORK/ac.txt")" = "true" ] || fail "pagination: $(cat "$WORK/ac.txt")"
  ac_call GET "admin/user/options?limit=5" "" "$admin"
  ac_expect 200 "admin/user/options (crud relation endpoint)"

  # ── admin users: create, edit, unpaged list, delete ─────────────────
  local cu_email="admin-made-$(date +%s)-$$@example.com" cu_phone cu_id cu_access
  cu_phone="+99891$(node -e 'process.stdout.write(String(Math.floor(1e6 + Math.random() * 8.9e6)))')"
  ac_call POST admin/users "$(ac_obj name Created email "$cu_email" phone "$cu_phone" password AdminSet123)" "$access"
  ac_expect 401 "create user with a user token"
  ac_call POST admin/users "$(ac_obj name Created email "$cu_email" phone "$cu_phone" password AdminSet123)" "$admin"
  ac_expect 201 "POST admin/users"
  cu_id=$(ac_json '.id' <"$WORK/ac.txt")
  grep -qi 'passwordHash\|AdminSet123' "$WORK/ac.txt" && fail "create user response leaks the password: $(cat "$WORK/ac.txt")"
  [ "$(ac_psql "SELECT password_hash LIKE '\$argon2id\$%' FROM users WHERE id = '$cu_id'")" = "t" ] || fail "admin-created password is not an argon2id hash"
  ac_call POST admin/users "$(ac_obj email "$(echo "$cu_email" | tr a-z A-Z)")" "$admin"
  ac_expect 409 "duplicate email (case-insensitive)"
  ac_call POST admin/users "$(ac_obj phone "$cu_phone")" "$admin"
  ac_expect 409 "duplicate phone"
  ac_call POST admin/users "$(ac_obj email not-an-email)" "$admin"
  ac_expect 400 "invalid email"
  ac_call PATCH "admin/users/$cu_id" "$(ac_obj phone "$phone")" "$admin"
  ac_expect 409 "edit onto another user's phone"
  ac_call PATCH "admin/users/$cu_id" "$(ac_obj name Renamed)" "$admin"
  ac_expect 200 "PATCH admin/users/:id"
  grep -q '"name":"Renamed"' "$WORK/ac.txt" || fail "patch response: $(cat "$WORK/ac.txt")"
  [ "$(ac_psql "SELECT password_hash LIKE '\$argon2id\$%' FROM users WHERE id = '$cu_id'")" = "t" ] || fail "edit without a password changed the hash"
  ac_call GET "admin/users?search=Renamed&limit=5" "" "$admin"
  ac_expect 200 "GET admin/users (unpaged)"
  [ "$(ac_json '.some(u => u.id === "'"$cu_id"'")' <"$WORK/ac.txt")" = "true" ] || fail "unpaged list misses the user: $(cat "$WORK/ac.txt")"
  ac_call GET "admin/users?limit=1001" "" "$admin"
  ac_expect 400 "limit above 1000"
  ac_call POST client/auth/email/sign-in "$(ac_obj email "$cu_email" password AdminSet123)"
  ac_expect 200 "sign-in as the admin-made user"
  cu_access=$(ac_json '.accessToken' <"$WORK/ac.txt")
  ac_call DELETE "admin/users/$cu_id" "" "$admin"
  ac_expect 200 "DELETE admin/users/:id"
  ac_call GET client/auth/me "" "$cu_access"
  ac_expect 401 "me after the admin deleted the user (sessions revoked)"
  ac_call GET "admin/users/$cu_id" "" "$admin"
  ac_expect 404 "deleted user is gone from the detail route"
  [ "$(ac_psql "SELECT count(*) FROM user_sessions WHERE user_id = '$cu_id' AND revoked_at IS NULL")" = "0" ] || fail "a session of the deleted user is still active"
  ac_call POST admin/users "$(ac_obj email "$cu_email" phone "$cu_phone")" "$admin"
  ac_expect 201 "a deleted user's email and phone can be reused"

  ac_call POST client/auth/sign-out "" "$access"
  ac_expect 200 "sign-out"
  ac_call GET client/auth/me "" "$access"
  ac_expect 401 "me after sign-out"
  log "Client auth OK"
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'auth_client_smoke; fi
