# Admin auth is part of the starter (no generator to run). Smoke checks against
# the booted API: the first super admin (ADMIN_EMAIL / ADMIN_PASSWORD from .env)
# signs in, reads `auth/me`, rotates the refresh token, and the old refresh
# token is refused (reuse detection revokes the session).
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
fi
