# Resumable uploads (tus) on top of upload. Both engines are generated so the
# tusd hook controller (and its jest spec with mocked hook requests) is built,
# linted and tested too; Docker is not needed because only the node engine is
# exercised against the running API (tusd itself runs in docker-compose).
# Smoke (node engine, admin token): create with Upload-Length, PATCH two chunks,
# HEAD to resume in between, then the media_files row, the result route and
# GET files/:id must match. Anonymous create → 401, oversize Upload-Length → 413,
# fake PNG → 415 on finish; with auth-client a user token uploads as well.
run_g upload-tus --engine tusd --skip-install
run_g upload-tus --engine node --skip-install

upload_tus_smoke() {
  log "Smoke: upload-tus (node engine)"
  local base="http://localhost:$API_PORT/api" email password access body code location upload_id media_id size half
  email="$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)"
  password="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
  json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s)$1;process.stdout.write(v===undefined?'':String(v))})"; }
  header() { grep -i "^$1:" "$2" | head -1 | cut -d' ' -f2- | tr -d '\r'; }
  b64() { printf %s "$1" | base64 | tr -d '\n'; }

  body=$(curl -fsS -X POST "$base/auth/sign-in" -H 'content-type: application/json' -H 'x-device-id: e2e-tus' \
    -d "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$email" "$password")") \
    || fail "admin sign-in failed"
  access=$(echo "$body" | json '.accessToken')
  [ -n "$access" ] || fail "sign-in response has no access token"

  # 1x1 PNG with a real signature, sent in two chunks.
  node -e "require('fs').writeFileSync(process.argv[1], Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))" "$WORK/tus.png"
  size=$(wc -c <"$WORK/tus.png" | tr -d ' ')
  half=$((size / 2))
  head -c "$half" "$WORK/tus.png" >"$WORK/tus.part1"
  tail -c "+$((half + 1))" "$WORK/tus.png" >"$WORK/tus.part2"
  local meta="filename $(b64 tus.png),filetype $(b64 image/png),usage $(b64 gallery)"

  code=$(curl -s -o "$WORK/tus-anon.txt" -w '%{http_code}' -X POST "$base/files/tus" \
    -H 'Tus-Resumable: 1.0.0' -H "Upload-Length: $size" -H "Upload-Metadata: $meta")
  [ "$code" = "401" ] || { cat "$WORK/tus-anon.txt"; fail "an anonymous tus create returned $code, expected 401."; }

  code=$(curl -s -o "$WORK/tus-big.txt" -w '%{http_code}' -X POST "$base/files/tus" -H "authorization: Bearer $access" \
    -H 'Tus-Resumable: 1.0.0' -H "Upload-Length: $((11 * 1024 * 1024))" -H "Upload-Metadata: $meta")
  [ "$code" = "413" ] || { cat "$WORK/tus-big.txt"; fail "an 11 MB image Upload-Length returned $code, expected 413."; }

  code=$(curl -s -o /dev/null -D "$WORK/tus-create.h" -w '%{http_code}' -X POST "$base/files/tus" -H "authorization: Bearer $access" \
    -H 'Tus-Resumable: 1.0.0' -H "Upload-Length: $size" -H "Upload-Metadata: $meta")
  [ "$code" = "201" ] || { cat "$WORK/tus-create.h"; fail "tus create returned $code, expected 201."; }
  location=$(header location "$WORK/tus-create.h")
  upload_id="${location##*/}"
  [ -n "$upload_id" ] && [ "${location%/*}" = "/api/files/tus" ] || { cat "$WORK/tus-create.h"; fail "unexpected Location: $location"; }

  code=$(curl -s -o /dev/null -D "$WORK/tus-p1.h" -w '%{http_code}' -X PATCH "$base/files/tus/$upload_id" \
    -H 'Tus-Resumable: 1.0.0' -H 'Upload-Offset: 0' -H 'Content-Type: application/offset+octet-stream' --data-binary "@$WORK/tus.part1")
  [ "$code" = "204" ] || { cat "$WORK/tus-p1.h"; fail "first PATCH returned $code, expected 204."; }
  [ "$(header upload-offset "$WORK/tus-p1.h")" = "$half" ] || { cat "$WORK/tus-p1.h"; fail "first PATCH Upload-Offset is not $half."; }

  code=$(curl -s -o /dev/null -I -D "$WORK/tus-head.h" -w '%{http_code}' "$base/files/tus/$upload_id" -H 'Tus-Resumable: 1.0.0')
  [ "$code" = "200" ] || { cat "$WORK/tus-head.h"; fail "HEAD returned $code, expected 200."; }
  [ "$(header upload-offset "$WORK/tus-head.h")|$(header upload-length "$WORK/tus-head.h")" = "$half|$size" ] \
    || { cat "$WORK/tus-head.h"; fail "HEAD does not report offset $half of $size."; }
  code=$(curl -s -o "$WORK/tus-result.json" -w '%{http_code}' "$base/files/tus/$upload_id/result")
  [ "$code|$(json '.status' <"$WORK/tus-result.json")" = "200|pending" ] || { cat "$WORK/tus-result.json"; fail "result of an unfinished upload is not pending."; }

  code=$(curl -s -o /dev/null -D "$WORK/tus-p2.h" -w '%{http_code}' -X PATCH "$base/files/tus/$upload_id" \
    -H 'Tus-Resumable: 1.0.0' -H "Upload-Offset: $half" -H 'Content-Type: application/offset+octet-stream' --data-binary "@$WORK/tus.part2")
  [ "$code" = "204" ] || { cat "$WORK/tus-p2.h"; fail "last PATCH returned $code, expected 204."; }
  media_id=$(header upload-media-id "$WORK/tus-p2.h")
  [ -n "$media_id" ] || { cat "$WORK/tus-p2.h"; fail "last PATCH has no Upload-Media-Id."; }

  [ "$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT kind || '|' || mime || '|' || size || '|' || used || '|' || usage || '|' || uploaded_by_type FROM media_files WHERE id = '$media_id'")" \
    = "image|image/png|$size|false|gallery|admin" ] || fail "media_files row of $media_id is missing or wrong."
  curl -fsS "$base/files/tus/$upload_id/result" >"$WORK/tus-result.json" || fail "GET files/tus/$upload_id/result failed"
  [ "$(json '.status' <"$WORK/tus-result.json")|$(json '.file.id' <"$WORK/tus-result.json")" = "done|$media_id" ] \
    || { cat "$WORK/tus-result.json"; fail "result does not point at media $media_id."; }
  curl -fsS -o "$WORK/tus.bin" "$base/files/$media_id" || fail "GET files/$media_id failed"
  cmp -s "$WORK/tus.bin" "$WORK/tus.png" || fail "GET files/$media_id returned different bytes."
  [ ! -e "uploads/.tus/$upload_id" ] && [ ! -e "uploads/.tus/$upload_id.json" ] || fail "the finished upload was left in uploads/.tus."

  # A text file announced as PNG: accepted on create, refused by its magic bytes on finish.
  printf 'not a png at all\n' >"$WORK/tus-fake.png"
  size=$(wc -c <"$WORK/tus-fake.png" | tr -d ' ')
  curl -s -o /dev/null -D "$WORK/tus-fake.h" -X POST "$base/files/tus" -H "authorization: Bearer $access" \
    -H 'Tus-Resumable: 1.0.0' -H "Upload-Length: $size" -H "Upload-Metadata: $meta"
  upload_id="$(header location "$WORK/tus-fake.h")"
  upload_id="${upload_id##*/}"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$base/files/tus/$upload_id" \
    -H 'Tus-Resumable: 1.0.0' -H 'Upload-Offset: 0' -H 'Content-Type: application/offset+octet-stream' --data-binary "@$WORK/tus-fake.png")
  [ "$code" = "415" ] || fail "a text file sent as PNG returned $code on finish, expected 415."
  [ "$(curl -fsS "$base/files/tus/$upload_id/result" | json '.status')" = "failed" ] || fail "the refused upload is not reported as failed."

  curl -fsS -X DELETE "$base/admin/files/$media_id" -H "authorization: Bearer $access" >/dev/null || fail "DELETE admin/files/$media_id failed"

  # With auth-client (52 runs before this step) a user token may create uploads too.
  if [ -d apps/api/src/client-auth ]; then
    local user user_id
    body=$(curl -fsS -X POST "$base/client/auth/email/sign-up" -H 'content-type: application/json' -H 'x-device-id: e2e-tus' \
      -d "{\"email\":\"e2e-tus-$(date +%s)-$$@example.com\",\"password\":\"TusPass1234\"}") || fail "client sign-up failed"
    user=$(echo "$body" | json '.accessToken')
    user_id=$(echo "$body" | json '.user.id')
    [ -n "$user" ] && [ -n "$user_id" ] || fail "client sign-up has no token: $body"
    size=$(wc -c <"$WORK/tus.png" | tr -d ' ')
    code=$(curl -s -o /dev/null -D "$WORK/tus-user.h" -w '%{http_code}' -X POST "$base/files/tus" -H "authorization: Bearer $user" \
      -H 'Tus-Resumable: 1.0.0' -H "Upload-Length: $size" -H "Upload-Metadata: $meta")
    [ "$code" = "201" ] || { cat "$WORK/tus-user.h"; fail "tus create with a user token returned $code, expected 201."; }
    upload_id="$(header location "$WORK/tus-user.h")"
    upload_id="${upload_id##*/}"
    code=$(curl -s -o /dev/null -D "$WORK/tus-user-p.h" -w '%{http_code}' -X PATCH "$base/files/tus/$upload_id" \
      -H 'Tus-Resumable: 1.0.0' -H 'Upload-Offset: 0' -H 'Content-Type: application/offset+octet-stream' --data-binary "@$WORK/tus.png")
    [ "$code" = "204" ] || { cat "$WORK/tus-user-p.h"; fail "user PATCH returned $code, expected 204."; }
    media_id=$(header upload-media-id "$WORK/tus-user-p.h")
    [ "$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
      "SELECT uploaded_by_type || '|' || uploaded_by_id || '|' || used FROM media_files WHERE id = '$media_id'")" = "user|$user_id|false" ] \
      || fail "media_files row of the user upload $media_id is missing or wrong."
    curl -fsS -X DELETE "$base/admin/files/$media_id" -H "authorization: Bearer $access" >/dev/null || fail "DELETE admin/files/$media_id failed"
  fi
  log "upload-tus OK"
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'upload_tus_smoke; fi
