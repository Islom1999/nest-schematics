# Notifications (needs 52-auth-client). FCM stays unconfigured: push is
# skipped with one warning and the API still boots.
# Smoke: a client user signs in and sets a push token, the admin broadcasts to
# all, the user sees it (pushStatus skipped, unread 1), marks it read (unread
# 0), the campaign shows sentCount, and a user token is refused on admin routes.
# Also: topic subscribe + topic broadcast, resend and delete of one notification,
# a campaign scheduled with sendAt (delayed job) and a cancelled one, a user's
# push devices (masked), and the migrations matching the entities.
run_g notifications --skip-install

notifications_smoke() {
  log "Smoke: notifications"
  local base="http://localhost:$API_PORT/api" email user admin campaign id topic topic_campaign later cancelled send_at status i body
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
  nt_call PUT client/auth/push-token "$(nt_obj token e2e-notify-token-0123456789 platform android)" "$user"
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
  [ "$(nt_psql "SELECT count(*) FROM user_sessions WHERE push_token = 'e2e-notify-token-0123456789'")" = "1" ] \
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

  # 6. Topics: the user subscribes, a topic broadcast reaches subscribers only.
  topic="e2e-news-$(date +%s)-$$"
  nt_call PUT "client/notifications/topics/bad%20topic" "" "$user"
  nt_expect 400 "subscribe to an invalid topic"
  nt_call PUT "client/notifications/topics/$topic" "" "$user"
  nt_expect 200 "subscribe to a topic"
  nt_call PUT "client/notifications/topics/$topic" "" "$user"
  nt_expect 200 "subscribe again"
  nt_call GET client/notifications/topics "" "$user"
  nt_expect 200 "GET client/notifications/topics"
  [ "$(nt_json '.length' <"$WORK/nt.txt")|$(nt_json '[0].topic' <"$WORK/nt.txt")" = "1|$topic" ] || fail "topics: $(cat "$WORK/nt.txt")"
  nt_call POST admin/notifications/broadcast '{"target":"topic","title":"No topic"}' "$admin"
  nt_expect 400 "topic broadcast without a topic"
  nt_call POST admin/notifications/broadcast "$(nt_obj target topic topic "$topic" title 'E2E topic' type news)" "$admin"
  nt_expect 200 "POST admin/notifications/broadcast (topic)"
  topic_campaign=$(nt_json '.id' <"$WORK/nt.txt")
  [ "$(nt_json '.target' <"$WORK/nt.txt")|$(nt_json '.filters.topic' <"$WORK/nt.txt")" = "topic|$topic" ] || fail "topic campaign: $(cat "$WORK/nt.txt")"
  for i in $(seq 1 30); do
    [ "$(nt_psql "SELECT count(*) FROM notifications WHERE campaign_id = '$topic_campaign'")" = "1" ] && break
    sleep 0.5
  done
  [ "$(nt_psql "SELECT user_id FROM notifications WHERE campaign_id = '$topic_campaign'")" = "$user_id" ] || fail "the topic broadcast did not reach exactly its subscriber"
  nt_call DELETE "client/notifications/topics/$topic" "" "$user"
  nt_expect 200 "unsubscribe"
  nt_call GET client/notifications/topics "" "$user"
  [ "$(nt_json '.length' <"$WORK/nt.txt")" = "0" ] || fail "topics after unsubscribe: $(cat "$WORK/nt.txt")"
  nt_call POST admin/notifications/broadcast "$(nt_obj target topic topic "$topic" title 'E2E nobody')" "$admin"
  nt_expect 200 "topic broadcast without subscribers"
  later=$(nt_json '.id' <"$WORK/nt.txt")
  for i in $(seq 1 30); do
    [ "$(nt_psql "SELECT status FROM notification_campaigns WHERE id = '$later'")" = "sent" ] && break
    sleep 0.5
  done
  [ "$(nt_psql "SELECT count(*) FROM notifications WHERE campaign_id = '$later'")" = "0" ] || fail "a topic without subscribers should reach nobody"

  # 7. Push devices of the user: platform, masked token, last seen.
  nt_call GET "admin/users/$user_id/push-devices" "" "$admin"
  nt_expect 200 "GET admin/users/:id/push-devices"
  node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    const d=r[0]; if (!(r.length===1 && d.platform==='android' && d.tokenMasked==='e2e-no…6789' && d.lastSeenAt && !JSON.stringify(r).includes('notify-token'))) process.exit(1)" "$WORK/nt.txt" \
    || fail "push devices: $(cat "$WORK/nt.txt")"
  nt_call GET "admin/users/00000000-0000-4000-8000-000000000000/push-devices" "" "$admin"
  nt_expect 404 "push devices of an unknown user"
  nt_call GET "admin/users/$user_id/push-devices" "" "$user"
  nt_expect 401 "push devices with a user token"

  # 8. Resend one notification (unread and pushed again), then delete it.
  nt_call POST "admin/notifications/$id/resend" "" "$admin"
  nt_expect 200 "POST admin/notifications/:id/resend"
  [ "$(nt_json '.id' <"$WORK/nt.txt")|$(nt_json '.pushStatus' <"$WORK/nt.txt")|$(nt_json '.readAt' <"$WORK/nt.txt")" = "$id|skipped|null" ] || fail "resend: $(cat "$WORK/nt.txt")"
  nt_call GET client/notifications/unread-count "" "$user"
  [ "$(nt_json '.count' <"$WORK/nt.txt")" = "2" ] || fail "unread-count after the resend (it and the topic one): $(cat "$WORK/nt.txt")"
  nt_call DELETE "admin/notifications/$id" "" "$admin"
  nt_expect 200 "DELETE admin/notifications/:id"
  nt_call GET "client/notifications?first=0&rows=50" "" "$user"
  node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if (r.data.some((n)=>n.id===process.argv[2])) process.exit(1)" "$WORK/nt.txt" "$id" || fail "the deleted notification is still listed"
  nt_call DELETE "admin/notifications/$id" "" "$admin"
  nt_expect 404 "delete an already deleted notification"
  nt_call POST "admin/notifications/$id/resend" "" "$admin"
  nt_expect 404 "resend a deleted notification"
  nt_call POST "admin/notifications/$id/resend" "" "$user"
  nt_expect 401 "resend with a user token"

  # 9. Scheduled sending: sendAt in the past is refused, one in a few seconds
  # goes out as a delayed job (queue), one that is cancelled never does.
  body=$(node -e 'const a=process.argv; console.log(JSON.stringify({target:"users",userIds:[a[1]],title:"E2E late",sendAt:a[2]}))' "$user_id" "$(node -e 'console.log(new Date(Date.now()-60000).toISOString())')")
  nt_call POST admin/notifications/broadcast "$body" "$admin"
  nt_expect 400 "sendAt in the past"
  send_at=$(node -e 'console.log(new Date(Date.now()+4000).toISOString())')
  body=$(node -e 'const a=process.argv; console.log(JSON.stringify({target:"users",userIds:[a[1]],title:"E2E later",sendAt:a[2]}))' "$user_id" "$send_at")
  nt_call POST admin/notifications/broadcast "$body" "$admin"
  nt_expect 200 "POST admin/notifications/broadcast (sendAt)"
  later=$(nt_json '.id' <"$WORK/nt.txt")
  [ "$(nt_json '.status' <"$WORK/nt.txt")" = "scheduled" ] || fail "a campaign with sendAt should be scheduled: $(cat "$WORK/nt.txt")"
  [ "$(nt_psql "SELECT count(*) FROM notifications WHERE campaign_id = '$later'")" = "0" ] || fail "the scheduled campaign sent before its time"
  for i in $(seq 1 40); do
    status=$(nt_psql "SELECT status FROM notification_campaigns WHERE id = '$later'")
    [ "$status" = "sent" ] && break
    sleep 0.5
  done
  [ "$status" = "sent" ] || fail "the scheduled campaign was not sent within 20 s (status $status)"
  [ "$(nt_psql "SELECT count(*) FROM notifications WHERE campaign_id = '$later'")" = "1" ] || fail "the scheduled campaign should reach its one user"
  nt_call DELETE "admin/notifications/campaigns/$later" "" "$admin"
  nt_expect 409 "cancel a campaign that was already sent"
  body=$(node -e 'const a=process.argv; console.log(JSON.stringify({target:"all",title:"E2E never",sendAt:a[1]}))' "$(node -e 'console.log(new Date(Date.now()+3600000).toISOString())')")
  nt_call POST admin/notifications/broadcast "$body" "$admin"
  nt_expect 200 "schedule a campaign for later"
  cancelled=$(nt_json '.id' <"$WORK/nt.txt")
  nt_call DELETE "admin/notifications/campaigns/$cancelled" "" "$admin"
  nt_expect 200 "cancel a scheduled campaign"
  nt_call GET "admin/notifications/campaigns/$cancelled" "" "$admin"
  nt_expect 404 "a cancelled campaign is gone"
  nt_call DELETE "admin/notifications/campaigns/$cancelled" "" "$admin"
  nt_expect 404 "cancel it again"

  # 10. A user token is refused on admin routes, an admin token on client routes.
  nt_call POST admin/notifications/campaigns/pagination '{"first":0,"rows":10}' "$user"
  nt_expect 401 "user token on an admin route"
  nt_call GET client/notifications "" "$admin"
  nt_expect 401 "admin token on a client route"

  # 11. The hand-written migrations match the entities.
  body=$(npm run --silent typeorm -- migration:generate libs/database/src/migrations/E2eCheck -d libs/database/src/data-source.ts --dryrun 2>&1 || true)
  if echo "$body" | grep -Eq '"(notifications|notification_campaigns|notification_topics)"'; then
    echo "$body"; fail "migration:generate finds differences in the notification tables"
  fi
  log "Notifications OK"
}

if [ -z "${E2E_RERUN:-}" ]; then E2E_SMOKE="${E2E_SMOKE:-}"$'\n'notifications_smoke; fi
