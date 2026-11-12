# server_api_logs. Smoke: a failed request with a password in the body is stored
# with the password masked and with its x-request-id; every response carries x-request-id.
run_g api-logs --skip-install

api_logs_psql() {
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc "$1"
}

api_logs_smoke() {
  log "api-logs: x-request-id and a masked error row"
  local base="http://localhost:$API_PORT/api" rid="e2e-$(date +%s)-$$" code="" path=""
  curl -s -o /dev/null -D "$WORK/apilog-401.h" "$base/admin/product"
  grep -qi '^x-request-id: [0-9a-f-]\{36\}' "$WORK/apilog-401.h" ||
    { cat "$WORK/apilog-401.h"; fail "a 401 response has no generated x-request-id."; }

  # Sign-in path differs between auth versions: use the first one that exists.
  for path in auth/sign-in admin/auth/login auth/login; do
    code=$(curl -s -o "$WORK/apilog.txt" -D "$WORK/apilog.h" -w '%{http_code}' -X POST "$base/$path" \
      -H 'content-type: application/json' -H "x-request-id: $rid" \
      -d '{"email":"not-an-email","password":"SuperSecret123","nested":{"refresh_token":"r1"}}')
    [ "$code" != "404" ] && break
  done
  [ "${code:0:1}" = "4" ] || { cat "$WORK/apilog.txt"; fail "POST $path returned $code, expected 4xx."; }
  grep -qi "^x-request-id: $rid" "$WORK/apilog.h" || { cat "$WORK/apilog.h"; fail "x-request-id was not echoed."; }

  local row=""
  for _ in $(seq 1 20); do
    row=$(api_logs_psql "SELECT status_code, request_body->>'password', request_body->'nested'->>'refresh_token', type
      FROM server_api_logs WHERE request_id = '$rid'")
    [ -n "$row" ] && break
    sleep 0.25
  done
  [ "$row" = "$code|***|***|API" ] || { cat "$WORK/api.log"; fail "server_api_logs row for $rid is '$row', expected '$code|***|***|API'."; }
  if api_logs_psql "SELECT count(*) FROM server_api_logs WHERE request_body::text LIKE '%SuperSecret123%'" | grep -qv '^0$'; then
    fail "a password reached server_api_logs unmasked."
  fi
  log "api-logs: row for $rid = $row"

  # ── CSV export and typed filters (admin token) ───────────────────────
  local admin email password uid="e2e-csv-$$"
  email="$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)"
  password="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
  admin=$(curl -fsS -X POST "$base/auth/sign-in" -H 'content-type: application/json' -H 'x-device-id: e2e-api-logs' \
    -d "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$email" "$password")" |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).accessToken||''))") ||
    fail "api-logs: admin sign-in failed"
  api_logs_psql "INSERT INTO server_api_logs (type, method, url, status_code, duration_ms, user_id, error)
    VALUES ('API', 'PUT', '/api/e2e/csv', 503, 777, '$uid', '=1+1|calc'), ('API', 'PUT', '/api/e2e/csv', 200, 5, '$uid', 'plain, with \"comma\"')" >/dev/null

  code=$(curl -s -o "$WORK/apilog-export.csv" -D "$WORK/apilog-export.h" -w '%{http_code}' "$base/admin/server-api-logs/export?userId=$uid" -H "authorization: Bearer $admin")
  [ "$code" = "200" ] || { cat "$WORK/apilog-export.csv"; fail "GET admin/server-api-logs/export returned $code, expected 200."; }
  grep -qi '^content-type: text/csv' "$WORK/apilog-export.h" || { cat "$WORK/apilog-export.h"; fail "export is not text/csv."; }
  grep -qi '^content-disposition: attachment; filename="server-api-logs-' "$WORK/apilog-export.h" || fail "export has no attachment filename."
  grep -q 'createdAt,id,type,module,handler,method,url,statusCode' "$WORK/apilog-export.csv" || { head -3 "$WORK/apilog-export.csv"; fail "export has no header line."; }
  [ "$(grep -c "$uid" "$WORK/apilog-export.csv")" = "2" ] || { cat "$WORK/apilog-export.csv"; fail "export of userId=$uid should have 2 rows."; }
  grep -q ",'=1+1|calc" "$WORK/apilog-export.csv" || { cat "$WORK/apilog-export.csv"; fail "export cell starting with '=' is not prefixed with a quote."; }
  grep -q '"plain, with ""comma"""' "$WORK/apilog-export.csv" || { cat "$WORK/apilog-export.csv"; fail "export cell with a comma and quotes is not escaped."; }
  # Same typed filters as the list: duration range narrows to the 503 row.
  curl -fsS "$base/admin/server-api-logs/export?userId=$uid&minDurationMs=100" -H "authorization: Bearer $admin" >"$WORK/apilog-export2.csv"
  [ "$(grep -c "$uid" "$WORK/apilog-export2.csv")" = "1" ] || { cat "$WORK/apilog-export2.csv"; fail "export minDurationMs filter should leave 1 row."; }
  curl -fsS "$base/admin/server-api-logs/export?filters=%7B%22statusCode%22%3A%7B%22value%22%3A503%2C%22matchMode%22%3A%22equals%22%7D%7D&userId=$uid" \
    -H "authorization: Bearer $admin" >"$WORK/apilog-export3.csv"
  [ "$(grep -c "$uid" "$WORK/apilog-export3.csv")" = "1" ] || { cat "$WORK/apilog-export3.csv"; fail "export with a JSON filters parameter should leave 1 row."; }
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base/admin/server-api-logs/export?limit=999999" -H "authorization: Bearer $admin")
  [ "$code" = "400" ] || fail "export with limit above the cap returned $code, expected 400."
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base/admin/server-api-logs/export?filters=not-json" -H "authorization: Bearer $admin")
  [ "$code" = "400" ] || fail "export with broken filters JSON returned $code, expected 400."
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base/admin/server-api-logs/export")
  [ "$code" = "401" ] || fail "export without a token returned $code, expected 401."
  curl -fsS -X POST "$base/admin/server-api-logs/pagination" -H 'content-type: application/json' -H "authorization: Bearer $admin" \
    -d "{\"first\":0,\"rows\":10,\"userId\":\"$uid\",\"method\":\"put\",\"statusCode\":503,\"path\":\"E2E/CSV\",\"minDurationMs\":700,\"maxDurationMs\":800}" >"$WORK/apilog-page.json"
  node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.exit(r.count===1&&r.data[0].durationMs===777&&!('requestBody' in r.data[0])?0:1)" "$WORK/apilog-page.json" ||
    { cat "$WORK/apilog-page.json"; fail "typed pagination filters should return exactly the 503 row."; }
  log "api-logs: CSV export and typed filters OK"
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'api_logs_smoke; fi
