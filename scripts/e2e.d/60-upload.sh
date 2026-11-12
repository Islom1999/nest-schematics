# media_files uploads (local storage) and a crud resource with a file field.
# Smoke: the admin uploads a PNG, a text file named .png is refused (415), the
# public GET files/:id answers ETag/304 and Range/206/416, attaching the file to
# a banner marks it used (delete → 409), detaching releases it (delete → 200).
run_g upload --storage local --skip-install
run_g crud banner --fields "title:string,image:file(image)?"

upload_smoke() {
  log "Smoke: uploads"
  local base="http://localhost:$API_PORT/api" email password access body code id spare size banner
  email="$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)"
  password="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
  json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s)$1;process.stdout.write(v===undefined?'':String(v))})"; }

  body=$(curl -fsS -X POST "$base/auth/sign-in" -H 'content-type: application/json' -H 'x-device-id: e2e-upload' \
    -d "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$email" "$password")") \
    || fail "admin sign-in failed"
  access=$(echo "$body" | json '.accessToken')
  [ -n "$access" ] || fail "sign-in response has no access token"
  local auth="authorization: Bearer $access"

  # 1x1 PNG (real signature) and a text file pretending to be one.
  node -e "require('fs').writeFileSync(process.argv[1], Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))" "$WORK/pixel.png"
  printf 'just some text, not an image\n' >"$WORK/fake.png"
  size=$(wc -c <"$WORK/pixel.png" | tr -d ' ')

  code=$(curl -s -o "$WORK/upload.json" -w '%{http_code}' -X POST "$base/admin/files/upload?usage=gallery" -H "$auth" \
    -F "files=@$WORK/pixel.png;type=image/png" -F "files=@$WORK/pixel.png;type=image/png")
  [ "$code" = "201" ] || { cat "$WORK/upload.json"; fail "POST admin/files/upload returned $code, expected 201."; }
  id=$(json '[0].id' <"$WORK/upload.json")
  spare=$(json '[1].id' <"$WORK/upload.json")
  [ "$(json '[0].kind' <"$WORK/upload.json")|$(json '[0].mime' <"$WORK/upload.json")|$(json '[0].size' <"$WORK/upload.json")|$(json '[0].used' <"$WORK/upload.json")" = "image|image/png|$size|false" ] \
    || { cat "$WORK/upload.json"; fail "unexpected upload response."; }

  code=$(curl -s -o "$WORK/fake.json" -w '%{http_code}' -X POST "$base/admin/files/upload" -H "$auth" -F "files=@$WORK/fake.png;type=image/png")
  [ "$code" = "415" ] || { cat "$WORK/fake.json"; fail "a text file named .png returned $code, expected 415."; }
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/admin/files/upload" -F "files=@$WORK/pixel.png;type=image/png")
  [ "$code" = "401" ] || fail "an anonymous admin upload returned $code, expected 401."
  if find uploads -path uploads/.tmp -prune -o -type f -name '*.png' -print 2>/dev/null | grep -q 'fake'; then
    fail "the original file name reached the storage."
  fi
  [ -z "$(ls -A uploads/.tmp 2>/dev/null)" ] || fail "temporary upload files were left in uploads/.tmp."

  curl -fsS -D "$WORK/file.h" -o "$WORK/file.bin" "$base/files/$id" || fail "GET files/$id failed"
  cmp -s "$WORK/file.bin" "$WORK/pixel.png" || fail "GET files/$id returned different bytes."
  local etag
  etag=$(grep -i '^etag:' "$WORK/file.h" | cut -d' ' -f2- | tr -d '\r')
  [ -n "$etag" ] || { cat "$WORK/file.h"; fail "GET files/:id has no ETag."; }
  grep -qi '^cache-control: public, max-age=' "$WORK/file.h" || { cat "$WORK/file.h"; fail "GET files/:id has no Cache-Control."; }
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base/files/$id" -H "if-none-match: $etag")
  [ "$code" = "304" ] || fail "If-None-Match returned $code, expected 304."

  code=$(curl -s -o "$WORK/part.bin" -D "$WORK/part.h" -w '%{http_code}' "$base/files/$id/stream" -H 'range: bytes=0-9')
  [ "$code" = "206" ] || { cat "$WORK/part.h"; fail "Range request returned $code, expected 206."; }
  grep -qi "^content-range: bytes 0-9/$size" "$WORK/part.h" || { cat "$WORK/part.h"; fail "wrong Content-Range."; }
  [ "$(wc -c <"$WORK/part.bin" | tr -d ' ')" = "10" ] || fail "the Range response is not 10 bytes."
  code=$(curl -s -o /dev/null -D "$WORK/bad.h" -w '%{http_code}' "$base/files/$id/stream" -H "range: bytes=$size-")
  [ "$code" = "416" ] || fail "an unsatisfiable range returned $code, expected 416."
  grep -qi "^content-range: bytes \*/$size" "$WORK/bad.h" || { cat "$WORK/bad.h"; fail "416 without Content-Range bytes */size."; }

  # Attaching the file to a crud record marks it used; detaching releases it.
  body=$(curl -fsS -X POST "$base/admin/banner" -H "$auth" -H 'content-type: application/json' \
    -d "{\"title\":\"Hero\",\"imageId\":\"$id\"}") || fail "POST admin/banner with imageId failed"
  banner=$(echo "$body" | json '.id')
  curl -fsS "$base/admin/files/$id" -H "$auth" | grep -q "\"used\":true" || fail "the attached file is not marked used."
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$base/admin/files/$id" -H "$auth")
  [ "$code" = "409" ] || fail "deleting a used file returned $code, expected 409."
  curl -fsS -X PUT "$base/admin/banner/$banner" -H "$auth" -H 'content-type: application/json' -d '{"imageId":null}' >/dev/null \
    || fail "PUT admin/banner imageId=null failed"
  curl -fsS "$base/admin/files/$id" -H "$auth" | grep -q "\"used\":false" || fail "the detached file was not released."

  curl -fsS -X DELETE "$base/admin/files/$id" -H "$auth" >/dev/null || fail "DELETE admin/files/$id failed"
  curl -fsS -X DELETE "$base/admin/files/$spare" -H "$auth" >/dev/null || fail "DELETE admin/files/$spare failed"
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base/files/$id")
  [ "$code" = "404" ] || fail "GET of a deleted file returned $code, expected 404."
  [ -z "$(find uploads -path uploads/.tmp -prune -o -type f -print 2>/dev/null)" ] || fail "deleted files are still in uploads/."
  log "Uploads OK"
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'upload_smoke; fi
