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
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'api_logs_smoke; fi
