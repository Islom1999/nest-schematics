# Notifications (needs 52-auth-client). FCM stays unconfigured: push is
# skipped with one warning and the API still boots.
# Smoke: a client user signs in and sets a push token, the admin broadcasts to
# all, the user sees it (pushStatus skipped, unread 1), marks it read (unread
# 0), the campaign shows sentCount, and a user token is refused on admin routes.
run_g notifications --skip-install

notifications_smoke() {
  log "Smoke: notifications"
  local base="http://localhost:$API_PORT/api" email user admin campaign id
  local NT_STATUS=""
  nt_json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s)$1;process.stdout.write(v===undefined?'':String(v))})"; }
  nt_obj() { node -e 'const a=process.argv.slice(1),o={};for(let i=0;i<a.length;i+=2)o[a[i]]=a[i+1];process.stdout.write(JSON.stringify(o))' "$@"; }
  nt_psql() { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc "$1"; }
  # nt_call METHOD PATH [BODY] [TOKEN]: response in $WORK/nt.txt, status in NT_STATUS.
  nt_call() {
    local args=(-s -o "$WORK/nt.txt" -w '%{http_code}' -X "$1" "$base/$2" -H 'content-type: application/json')
    [ -n "${3:-}" ] && args+=(-d "$3")
    [ -n "${4:-}" ] && args+=(-H "authorization: Bearer $4")
    NT_STATUS=$(curl "${args[@]}")
  }
  nt_expect() { [ "$NT_STATUS" = "$1" ] || { cat "$WORK/nt.txt"; echo; fail "$2: got HTTP $NT_STATUS, expected $1"; }; }

  # 1. A client user signs in (email + password) and sets a push token.
  email="e2e-notify-$(date +%s)-$$@example.com"
  nt_call POST client/auth/email/sign-up "$(nt_obj email "$email" password NotifyPass123 name Notify)"
  nt_expect 200 "email sign-up"
  nt_call POST client/auth/email/sign-in "$(nt_obj email "$email" password NotifyPass123)"
  nt_expect 200 "email sign-in"
  user=$(nt_json '.accessToken' <"$WORK/nt.txt")
  nt_call PUT client/auth/push-token "$(nt_obj token e2e-notify-token platform android)" "$user"
  nt_expect 200 "PUT push-token"
  nt_call GET client/notifications/unread-count "" "$user"
  nt_expect 200 "unread-count before"
  [ "$(nt_json '.count' <"$WORK/nt.txt")" = "0" ] || fail "unread-count before the broadcast: $(cat "$WORK/nt.txt")"

  # 2. The admin broadcasts to everyone.
  nt_call POST auth/sign-in "$(nt_obj email "$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)" password "$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)")"
  nt_expect 200 "admin sign-in"
  admin=$(nt_json '.accessToken' <"$WORK/nt.txt")
  nt_call POST admin/notifications/broadcast '{"target":"users"}' "$admin"
  nt_expect 400 "broadcast to users without userIds"
  nt_call POST admin/notifications/broadcast '{"target":"all","type":"promo","title":"E2E sale","body":"Everything is 20% off","link":"/sale"}' "$admin"
  nt_expect 200 "POST admin/notifications/broadcast"
  campaign=$(nt_json '.id' <"$WORK/nt.txt")
  [ -n "$campaign" ] || fail "broadcast returned no campaign: $(cat "$WORK/nt.txt")"

  # 3. The user sees it: push skipped (FCM unconfigured), one unread.
  nt_call GET "client/notifications?first=0&rows=10" "" "$user"
  nt_expect 200 "GET client/notifications"
  [ "$(nt_json '.count' <"$WORK/nt.txt")" = "1" ] || fail "client/notifications: $(cat "$WORK/nt.txt")"
  [ "$(nt_json '.data[0].campaignId' <"$WORK/nt.txt")|$(nt_json '.data[0].pushStatus' <"$WORK/nt.txt")|$(nt_json '.data[0].title' <"$WORK/nt.txt")" = "$campaign|skipped|E2E sale" ] \
    || fail "unexpected notification: $(cat "$WORK/nt.txt")"
  id=$(nt_json '.data[0].id' <"$WORK/nt.txt")
  nt_call GET client/notifications/unread-count "" "$user"
  nt_expect 200 "unread-count"
  [ "$(nt_json '.count' <"$WORK/nt.txt")" = "1" ] || fail "unread-count after the broadcast: $(cat "$WORK/nt.txt")"
  [ "$(nt_psql "SELECT count(*) FROM user_sessions WHERE push_token = 'e2e-notify-token'")" = "1" ] \
    || fail "the push token was cleared although FCM is not configured"
  [ "$(grep -c 'FIREBASE_SERVICE_ACCOUNT_JSON is not set' "$WORK/api.log")" = "1" ] || fail "expected exactly one FCM warning in the server log"

  # 4. Mark it read.
  nt_call POST "client/notifications/$id/read" "" "$user"
  nt_expect 200 "mark read"
  [ -n "$(nt_json '.readAt' <"$WORK/nt.txt")" ] || fail "readAt not set: $(cat "$WORK/nt.txt")"
  nt_call GET client/notifications/unread-count "" "$user"
  [ "$(nt_json '.count' <"$WORK/nt.txt")" = "0" ] || fail "unread-count after read: $(cat "$WORK/nt.txt")"
  nt_call POST client/notifications/read-all "" "$user"
  nt_expect 200 "read-all"

  # 5. The campaign shows sentCount (every active user got a notification).
  nt_call GET "admin/notifications/campaigns/$campaign" "" "$admin"
  nt_expect 200 "GET admin/notifications/campaigns/:id"
  node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    if (!(r.campaign.sentCount >= 1 && r.campaign.sentCount === r.stats.total && r.stats.pushSkipped === r.stats.total && r.stats.read >= 1)) process.exit(1)" "$WORK/nt.txt" \
    || fail "campaign detail: $(cat "$WORK/nt.txt")"
  nt_call POST admin/notifications/campaigns/pagination '{"first":0,"rows":10}' "$admin"
  nt_expect 200 "campaigns pagination"
  [ "$(nt_json '.data[0].id' <"$WORK/nt.txt")" = "$campaign" ] || fail "campaigns pagination: $(cat "$WORK/nt.txt")"
  local user_id
  user_id=$(nt_psql "SELECT user_id FROM notifications WHERE id = '$id'")
  nt_call POST admin/notifications/pagination "$(nt_obj userId "$user_id")" "$admin"
  nt_expect 200 "notifications pagination by user"
  [ "$(nt_json '.count' <"$WORK/nt.txt")" = "1" ] || fail "notifications pagination by user: $(cat "$WORK/nt.txt")"

  # 6. A user token is refused on admin routes, an admin token on client routes.
  nt_call POST admin/notifications/campaigns/pagination '{"first":0,"rows":10}' "$user"
  nt_expect 401 "user token on an admin route"
  nt_call GET client/notifications "" "$admin"
  nt_expect 401 "admin token on a client route"
  log "Notifications OK"
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'notifications_smoke; fi
