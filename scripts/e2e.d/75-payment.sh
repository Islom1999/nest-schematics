# Payments: Payme then Click on one core (wallet mode, the default; needs
# 52-auth-client). Test keys go into the GENERATED project's .env only.
# Smoke: a client user checks out, Payme JSON-RPC (CheckPerform, Create,
# Perform, CheckTransaction, GetStatement, wrong auth -32504, cancel after
# perform), Click prepare/complete with an MD5 sign (bad sign -1), wallet
# balances, admin/payments, ten parallel wallet debits under the row lock, and
# no migration diff for the payment tables.
# Then Uzum, Paynet and inPAY (inPAY's API is a local stub server): success,
# bad auth, repeated calls change nothing, reverse / cancel.
run_g payment payme --skip-install
run_g payment click --skip-install
run_g payment uzum --skip-install
run_g payment paynet --skip-install
run_g payment inpay --skip-install

if [ -z "${E2E_RERUN:-}" ]; then
  node - "$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')" <<'NODE'
const fs = require('fs');
const set = {
  PAYME_MERCHANT_ID: 'e2e-merchant',
  PAYME_TEST_MODE: 'true',
  PAYME_TEST_KEY: 'e2e-payme-test-key',
  CLICK_SERVICE_ID: '1234',
  CLICK_MERCHANT_ID: '5678',
  CLICK_SECRET_KEY: 'e2e-click-secret',
  UZUM_SERVICE_ID: '4321',
  UZUM_LOGIN: 'e2e-uzum',
  UZUM_PASSWORD: 'e2e-uzum-password',
  PAYNET_LOGIN: 'e2e-paynet',
  PAYNET_PASSWORD: 'e2e-paynet-password',
  INPAY_MERCHANT_ID: 'e2e-inpay',
  INPAY_MERCHANT_TOKEN: 'e2e-inpay-token',
  // The stub inPAY API listens here during the smoke (a free port picked now).
  INPAY_API_URL: `http://127.0.0.1:${process.argv[2]}/api/v1`,
};
let env = fs.readFileSync('.env', 'utf8');
for (const [k, v] of Object.entries(set)) {
  if (!new RegExp(`^${k}=`, 'm').test(env)) throw new Error(`${k} missing from .env`);
  env = env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);
}
fs.writeFileSync('.env', env);
NODE
  E2E_SMOKE="${E2E_SMOKE:-}"$'\n'payment_smoke$'\n'payment_providers_smoke
fi

payment_smoke() {
  log "Smoke: payments (Payme, Click, wallet)"
  local base="http://localhost:$API_PORT/api" email user access admin body invoice payme_id now tx click_id prepare_id status ok
  local PM_STATUS=""
  pm_json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s)$1;process.stdout.write(v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v))})"; }
  pm_obj() { node -e 'const a=process.argv.slice(1),o={};for(let i=0;i<a.length;i+=2)o[a[i]]=/^-?\d+$/.test(a[i+1])?Number(a[i+1]):a[i+1];process.stdout.write(JSON.stringify(o))' "$@"; }
  pm_psql() { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc "$1"; }
  pm_call() {
    local args=(-s -o "$WORK/pm.txt" -w '%{http_code}' -X "$1" "$base/$2" -H 'content-type: application/json')
    [ -n "${3:-}" ] && args+=(-d "$3")
    [ -n "${4:-}" ] && args+=(-H "authorization: Bearer $4")
    PM_STATUS=$(curl "${args[@]}")
  }
  pm_expect() { [ "$PM_STATUS" = "$1" ] || { cat "$WORK/pm.txt"; echo; fail "$2: got HTTP $PM_STATUS, expected $1"; }; }
  # payme METHOD PARAMS_JSON [KEY]: JSON-RPC with Basic Paycom:<key> (default: the test key in .env).
  payme() {
    local key="${3:-$(grep -E '^PAYME_TEST_KEY=' .env | cut -d= -f2-)}"
    curl -s -X POST "$base/payments/payme" -H 'content-type: application/json' \
      -H "authorization: Basic $(printf 'Paycom:%s' "$key" | base64)" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":$RANDOM,\"method\":\"$1\",\"params\":$2}"
  }
  # click prepare|complete ACCOUNT AMOUNT CLICK_TRANS_ID [PREPARE_ID] [SECRET]: a signed form post.
  click() {
    local secret="${6:-$(grep -E '^CLICK_SECRET_KEY=' .env | cut -d= -f2-)}" service action sign_time sign
    service="$(grep -E '^CLICK_SERVICE_ID=' .env | cut -d= -f2-)"
    action=0; [ "$1" = "complete" ] && action=1
    sign_time="$(date '+%Y-%m-%d %H:%M:%S')"
    sign=$(node -e 'process.stdout.write(require("crypto").createHash("md5").update(process.argv.slice(1).join("")).digest("hex"))' \
      "$4" "$service" "$secret" "$2" "${5:-}" "$3" "$action" "$sign_time")
    local form=(--data-urlencode "click_trans_id=$4" --data-urlencode "service_id=$service" --data-urlencode "click_paydoc_id=9$4"
      --data-urlencode "merchant_trans_id=$2" --data-urlencode "amount=$3" --data-urlencode "action=$action" --data-urlencode "error=0"
      --data-urlencode "error_note=Success" --data-urlencode "sign_time=$sign_time" --data-urlencode "sign_string=$sign")
    [ -n "${5:-}" ] && form+=(--data-urlencode "merchant_prepare_id=$5")
    curl -s -X POST "$base/payments/click/$1" "${form[@]}"
  }

  # ── client user (email sign-up, as in 52-auth-client) ─────────────────
  email="e2e-pay-$(date +%s)-$$@example.com"
  pm_call POST client/auth/email/sign-up "$(pm_obj email "$email" password PayPass12345 name Payer)"
  pm_expect 200 "client sign-up"
  pm_call POST client/auth/email/sign-in "$(pm_obj email "$email" password PayPass12345)"
  pm_expect 200 "client sign-in"
  access=$(pm_json '.accessToken' <"$WORK/pm.txt")
  user=$(pm_psql "SELECT id FROM users WHERE email = '$email'")

  # ── Payme ──────────────────────────────────────────────────────────────
  pm_call POST client/payments/checkout '{"provider":"payme","amount":500000}' "$access"
  pm_expect 200 "Payme checkout"
  invoice=$(pm_json '.invoiceNumber' <"$WORK/pm.txt")
  [ "$invoice" -ge 1000000000 ] || fail "invoice number: $(cat "$WORK/pm.txt")"
  body=$(pm_json '.payUrl' <"$WORK/pm.txt")
  [ "$(node -e 'process.stdout.write(Buffer.from(process.argv[1].split("/").pop(),"base64").toString())' "$body")" = \
    "m=e2e-merchant;ac.account=$invoice;a=500000" ] || fail "Payme pay URL: $body"
  pm_call POST client/payments/checkout '{"provider":"payme","amount":500000,"extra":1}' "$access"
  pm_expect 400 "checkout with an unknown field"

  body=$(payme CheckPerformTransaction "{\"amount\":500000,\"account\":{\"account\":\"$invoice\"}}")
  [ "$(echo "$body" | pm_json '.result.allow')" = "true" ] || fail "CheckPerformTransaction: $body"
  body=$(payme CheckPerformTransaction "{\"amount\":400000,\"account\":{\"account\":\"$invoice\"}}")
  [ "$(echo "$body" | pm_json '.error.code')" = "-31001" ] || fail "CheckPerformTransaction with a wrong amount: $body"
  body=$(payme CheckPerformTransaction "{\"amount\":500000,\"account\":{\"account\":\"$invoice\"}}" wrong-key)
  [ "$(echo "$body" | pm_json '.error.code')" = "-32504" ] || fail "wrong Payme auth: $body"
  [ -n "$(echo "$body" | pm_json '.error.message.uz')" ] || fail "Payme error without uz message: $body"

  payme_id="e2e$(date +%s)$$"
  now=$(node -e 'process.stdout.write(String(Date.now()))')
  local create="{\"id\":\"$payme_id\",\"time\":$now,\"amount\":500000,\"account\":{\"account\":\"$invoice\"}}"
  body=$(payme CreateTransaction "$create")
  [ "$(echo "$body" | pm_json '.result.state')" = "1" ] || fail "CreateTransaction: $body"
  tx=$(echo "$body" | pm_json '.result.transaction')
  body=$(payme CreateTransaction "$create")
  [ "$(echo "$body" | pm_json '.result.transaction')" = "$tx" ] || fail "a repeated CreateTransaction gave another transaction: $body"
  body=$(payme PerformTransaction "{\"id\":\"$payme_id\"}")
  [ "$(echo "$body" | pm_json '.result.state')" = "2" ] || fail "PerformTransaction: $body"
  body=$(payme PerformTransaction "{\"id\":\"$payme_id\"}")
  [ "$(echo "$body" | pm_json '.result.state')" = "2" ] || fail "a repeated PerformTransaction: $body"

  pm_call GET client/wallet "" "$access"
  pm_expect 200 "GET client/wallet"
  [ "$(pm_json '.balance' <"$WORK/pm.txt")" = "500000" ] || fail "wallet after Payme: $(cat "$WORK/pm.txt")"
  body=$(payme CheckTransaction "{\"id\":\"$payme_id\"}")
  [ "$(echo "$body" | pm_json '.result.state')" = "2" ] && [ "$(echo "$body" | pm_json '.result.perform_time > 0')" = "true" ] \
    || fail "CheckTransaction: $body"
  body=$(payme GetStatement "{\"from\":$((now - 60000)),\"to\":$((now + 60000))}")
  [ "$(echo "$body" | pm_json ".result.transactions.filter(t => t.id === '$payme_id' && t.state === 2).length")" = "1" ] \
    || fail "GetStatement: $body"
  [ "$(payme ChangePassword '{"password":"x"}' | pm_json '.error.code')" = "-32601" ] || fail "ChangePassword is not -32601"

  body=$(payme CancelTransaction "{\"id\":\"$payme_id\",\"reason\":5}")
  [ "$(echo "$body" | pm_json '.result.state')" = "-2" ] || fail "CancelTransaction after perform: $body"
  pm_call GET client/wallet "" "$access"
  [ "$(pm_json '.balance' <"$WORK/pm.txt")" = "0" ] || fail "wallet after the Payme cancel: $(cat "$WORK/pm.txt")"
  [ "$(pm_psql "SELECT string_agg(wt.type || ':' || wt.amount, ',' ORDER BY wt.created_at) FROM wallet_transactions wt JOIN wallets w ON w.id = wt.wallet_id WHERE w.user_id = '$user'")" = \
    "topup:500000,reversal:-500000" ] || fail "wallet ledger after the Payme cancel"

  # ── Click ──────────────────────────────────────────────────────────────
  pm_call POST client/payments/checkout '{"provider":"click","amount":300000}' "$access"
  pm_expect 200 "Click checkout"
  invoice=$(pm_json '.invoiceNumber' <"$WORK/pm.txt")
  pm_json '.payUrl' <"$WORK/pm.txt" | grep -q "transaction_param=$invoice" || fail "Click pay URL: $(cat "$WORK/pm.txt")"
  click_id="$(date +%s)$$"
  body=$(click prepare "$invoice" 3000.00 "$click_id" "" wrong-secret)
  [ "$(echo "$body" | pm_json '.error')" = "-1" ] || fail "Click prepare with a bad sign: $body"
  body=$(click prepare "$invoice" 3000.00 "$click_id")
  [ "$(echo "$body" | pm_json '.error')" = "0" ] || fail "Click prepare: $body"
  prepare_id=$(echo "$body" | pm_json '.merchant_prepare_id')
  body=$(click complete "$invoice" 3000.00 "$click_id" "$prepare_id")
  [ "$(echo "$body" | pm_json '.error')" = "0" ] && [ "$(echo "$body" | pm_json '.merchant_confirm_id')" = "$prepare_id" ] \
    || fail "Click complete: $body"
  [ "$(click complete "$invoice" 3000.00 "$click_id" "$prepare_id" | pm_json '.error')" = "-4" ] || fail "a repeated Click complete is not -4"
  pm_call GET client/wallet "" "$access"
  [ "$(pm_json '.balance' <"$WORK/pm.txt")" = "300000" ] || fail "wallet after Click: $(cat "$WORK/pm.txt")"
  pm_call GET "client/payments?limit=10" "" "$access"
  pm_expect 200 "GET client/payments"
  [ "$(pm_json '.count' <"$WORK/pm.txt")" = "2" ] || fail "client/payments: $(cat "$WORK/pm.txt")"

  # ── admin: payments table, wallets, concurrent debits ─────────────────
  pm_call POST auth/sign-in "$(pm_obj email "$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)" password "$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)")"
  pm_expect 200 "admin sign-in"
  admin=$(pm_json '.accessToken' <"$WORK/pm.txt")
  pm_call POST admin/payments/pagination '{"first":0,"rows":10}' "$admin"
  pm_expect 200 "admin/payments pagination"
  [ "$(pm_json '.data.filter(p => p.userId === "'"$user"'").length' <"$WORK/pm.txt")" = "2" ] || fail "admin/payments: $(cat "$WORK/pm.txt")"
  pm_call POST admin/payments/pagination '{"first":0,"rows":10}' "$access"
  pm_expect 401 "a user token on admin/payments"

  # Balance 300000; ten parallel debits of 100000: exactly three succeed, none overdraws.
  # Wait for these curls only: a bare `wait` would also wait for the API process.
  local pids=()
  : >"$WORK/pm-parallel.txt"
  for i in $(seq 1 10); do
    curl -s -o /dev/null -w '%{http_code}\n' -X POST "$base/admin/wallets/adjust" -H 'content-type: application/json' \
      -H "authorization: Bearer $admin" -d "{\"userId\":\"$user\",\"amount\":-100000,\"note\":\"e2e parallel $i\"}" >>"$WORK/pm-parallel.txt" &
    pids+=($!)
  done
  wait "${pids[@]}"
  ok=$(grep -c '^200$' "$WORK/pm-parallel.txt" || true)
  status=$(grep -vc '^200$' "$WORK/pm-parallel.txt" || true)
  [ "$ok" = "3" ] && [ "$status" = "7" ] || { sort "$WORK/pm-parallel.txt" | uniq -c; fail "parallel wallet debits: $ok succeeded, expected 3"; }
  [ "$(pm_psql "SELECT balance FROM wallets WHERE user_id = '$user'")" = "0" ] || fail "balance after parallel debits"
  pm_call GET client/wallet "" "$access"
  [ "$(pm_json '.balance' <"$WORK/pm.txt")" = "0" ] || fail "client/wallet after parallel debits"

  # ── the hand-written migrations match the entities ─────────────────────
  body=$(npm run --silent typeorm -- migration:generate libs/database/src/migrations/E2eCheck -d libs/database/src/data-source.ts --dryrun 2>&1 || true)
  if echo "$body" | grep -Eq '"(payment_invoices|payment_transactions|wallets|wallet_transactions)"'; then
    echo "$body"; fail "migration:generate finds differences in the payment tables"
  fi
  log "Payments OK"
}

payment_providers_smoke() {
  log "Smoke: payments (Uzum, Paynet, inPAY)"
  local base="http://localhost:$API_PORT/api" email user access admin body invoice account trans_id order status port stub_pid i
  local PP_STATUS=""
  pp_json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s)$1;process.stdout.write(v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v))})"; }
  pp_env() { grep -E "^$1=" .env | cut -d= -f2-; }
  pp_psql() { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc "$1"; }
  pp_call() {
    local args=(-s -o "$WORK/pp.txt" -w '%{http_code}' -X "$1" "$base/$2" -H 'content-type: application/json')
    [ -n "${3:-}" ] && args+=(-d "$3")
    [ -n "${4:-}" ] && args+=(-H "authorization: Bearer $4")
    PP_STATUS=$(curl "${args[@]}")
  }
  pp_expect() { [ "$PP_STATUS" = "$1" ] || { cat "$WORK/pp.txt"; echo; fail "$2: got HTTP $PP_STATUS, expected $1"; }; }
  pp_balance() { pp_call GET client/wallet "" "$access"; pp_json '.balance' <"$WORK/pp.txt"; }
  pp_checkout() {
    pp_call POST client/payments/checkout "{\"provider\":\"$1\",\"amount\":$2}" "$access"
    pp_expect 200 "$1 checkout"
    invoice=$(pp_json '.invoiceNumber' <"$WORK/pp.txt")
  }
  # uzum OPERATION FIELDS_JSON [PASSWORD]: writes the body to $WORK/uz.txt, prints the HTTP status.
  uzum() {
    local password="${3:-$(pp_env UZUM_PASSWORD)}"
    curl -s -o "$WORK/uz.txt" -w '%{http_code}' -X POST "$base/payments/uzum/$1" -H 'content-type: application/json' \
      -H "authorization: Basic $(printf '%s:%s' "$(pp_env UZUM_LOGIN)" "$password" | base64)" \
      -d "{\"serviceId\":$(pp_env UZUM_SERVICE_ID),\"timestamp\":$(date +%s)000,$2}"
  }
  uz() { pp_json "$1" <"$WORK/uz.txt"; }
  # paynet METHOD PARAMS_JSON [PASSWORD]: JSON-RPC with Basic <login>:<password>.
  paynet() {
    local password="${3:-$(pp_env PAYNET_PASSWORD)}"
    curl -s -X POST "$base/payments/paynet" -H 'content-type: application/json' \
      -H "authorization: Basic $(printf '%s:%s' "$(pp_env PAYNET_LOGIN)" "$password" | base64)" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":$RANDOM,\"method\":\"$1\",\"params\":$2}"
  }
  # Tashkent time (UTC+5) shifted by $1 seconds, as Paynet sends it.
  paynet_time() { node -p "new Date(Date.now() + 5 * 3600e3 + ($1) * 1000).toISOString().slice(0, 19).replace('T', ' ')"; }
  inpay_webhook() { curl -s -o "$WORK/pp-hook.txt" -w '%{http_code}' -X POST "$base/payments/inpay/webhook" -H 'content-type: application/json' -d "$1"; }

  email="e2e-pay2-$(date +%s)-$$@example.com"
  pp_call POST client/auth/email/sign-up "{\"email\":\"$email\",\"password\":\"PayPass12345\",\"name\":\"Payer2\"}"
  pp_expect 200 "client sign-up"
  pp_call POST client/auth/email/sign-in "{\"email\":\"$email\",\"password\":\"PayPass12345\"}"
  pp_expect 200 "client sign-in"
  access=$(pp_json '.accessToken' <"$WORK/pp.txt")
  user=$(pp_psql "SELECT id FROM users WHERE email = '$email'")
  account=$(pp_psql "SELECT account_no FROM users WHERE id = '$user'")

  # ── Uzum ───────────────────────────────────────────────────────────────
  pp_checkout uzum 400000
  [ "$(pp_json '.payUrl' <"$WORK/pp.txt")" = "" ] || fail "Uzum payUrl without UZUM_PAY_URL: $(cat "$WORK/pp.txt")"
  [ "$(uzum check "\"params\":{\"account\":\"$invoice\"}" wrong-password)" = "400" ] && [ "$(uz '.errorCode')" = "10001" ] \
    || fail "Uzum bad auth: $(cat "$WORK/uz.txt")"
  [ "$(uzum check "\"params\":{\"account\":\"$invoice\"}")" = "200" ] && [ "$(uz '.status')" = "OK" ] || fail "Uzum check: $(cat "$WORK/uz.txt")"
  trans_id="uz-$invoice"
  [ "$(uzum create "\"transId\":\"$trans_id\",\"params\":{\"account\":\"$invoice\"},\"amount\":300000")" = "400" ] \
    || fail "Uzum create with a wrong amount: $(cat "$WORK/uz.txt")"
  for i in 1 2; do
    [ "$(uzum create "\"transId\":\"$trans_id\",\"params\":{\"account\":\"$invoice\"},\"amount\":400000")" = "200" ] && [ "$(uz '.status')" = "CREATED" ] \
      || fail "Uzum create #$i: $(cat "$WORK/uz.txt")"
  done
  for i in 1 2; do
    [ "$(uzum confirm "\"transId\":\"$trans_id\"")" = "200" ] && [ "$(uz '.status')" = "CONFIRMED" ] || fail "Uzum confirm #$i: $(cat "$WORK/uz.txt")"
  done
  [ "$(pp_balance)" = "400000" ] || fail "wallet after Uzum: $(cat "$WORK/pp.txt")"
  [ "$(uzum status "\"transId\":\"$trans_id\"")" = "200" ] && [ "$(uz '.status')" = "CONFIRMED" ] || fail "Uzum status: $(cat "$WORK/uz.txt")"
  for i in 1 2; do
    [ "$(uzum reverse "\"transId\":\"$trans_id\"")" = "200" ] && [ "$(uz '.status')" = "REVERSED" ] || fail "Uzum reverse #$i: $(cat "$WORK/uz.txt")"
  done
  [ "$(pp_balance)" = "0" ] || fail "wallet after the Uzum reverse: $(cat "$WORK/pp.txt")"

  # ── Paynet ─────────────────────────────────────────────────────────────
  pp_checkout paynet 300000
  [ "$(paynet GetInformation "{\"fields\":{\"account\":\"$invoice\"}}" wrong-password | pp_json '.error.code')" = "412" ] || fail "Paynet bad auth"
  body=$(paynet GetInformation "{\"fields\":{\"account\":\"$invoice\"}}")
  [ "$(echo "$body" | pp_json '.result.status')" = "0" ] || fail "Paynet GetInformation: $body"
  trans_id="$(date +%s)$$"
  body=$(paynet PerformTransaction "{\"transactionId\":$trans_id,\"amount\":300000,\"fields\":{\"account\":\"$invoice\"},\"timestamp\":\"$(paynet_time 0)\"}")
  [ -n "$(echo "$body" | pp_json '.result.providerTrnId')" ] || fail "Paynet PerformTransaction: $body"
  body=$(paynet PerformTransaction "{\"transactionId\":$trans_id,\"amount\":300000,\"fields\":{\"account\":\"$invoice\"}}")
  [ "$(echo "$body" | pp_json '.error.code')" = "201" ] || fail "a repeated Paynet PerformTransaction is not 201: $body"
  [ "$(pp_balance)" = "300000" ] || fail "wallet after Paynet: $(cat "$WORK/pp.txt")"
  [ "$(paynet CheckTransaction "{\"transactionId\":$trans_id}" | pp_json '.result.transactionState')" = "1" ] || fail "Paynet CheckTransaction"
  body=$(paynet CancelTransaction "{\"transactionId\":$trans_id}")
  [ "$(echo "$body" | pp_json '.result.transactionState')" = "2" ] || fail "Paynet CancelTransaction: $body"
  [ "$(paynet CancelTransaction "{\"transactionId\":$trans_id}" | pp_json '.error.code')" = "202" ] || fail "a repeated Paynet cancel is not 202"
  [ "$(pp_balance)" = "0" ] || fail "wallet after the Paynet cancel: $(cat "$WORK/pp.txt")"
  # A direct top-up by the user's account number, then GetStatement (performed ones only).
  body=$(paynet PerformTransaction "{\"transactionId\":$((trans_id + 1)),\"amount\":200000,\"fields\":{\"account\":\"$account\"},\"timestamp\":\"$(paynet_time 0)\"}")
  [ -n "$(echo "$body" | pp_json '.result.providerTrnId')" ] || fail "Paynet top-up by account number: $body"
  body=$(paynet GetStatement "{\"dateFrom\":\"$(paynet_time -3600)\",\"dateTo\":\"$(paynet_time 3600)\"}")
  [ "$(echo "$body" | pp_json ".result.statements.filter(s => s.transactionId === $((trans_id + 1)) && s.amount === 200000).length")" = "1" ] \
    && [ "$(echo "$body" | pp_json ".result.statements.filter(s => s.transactionId === $trans_id).length")" = "0" ] || fail "Paynet GetStatement: $body"
  [ "$(pp_balance)" = "200000" ] || fail "wallet after the Paynet top-up"

  # ── inPAY (a local stub of its API) ────────────────────────────────────
  port=$(pp_env INPAY_API_URL | sed -E 's#^http://127\.0\.0\.1:([0-9]+)/.*#\1#')
  cat >"$WORK/inpay-stub.js" <<'STUB'
// Stub of the inPAY API (authorization, create, transactions); /__set and /__stats drive the smoke.
const http = require('http');
const [port, parent] = process.argv.slice(2).map(Number);
const orders = new Map();
const stats = { auth: 0 };
let seq = 0;
const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d)).on('end', () => {
      const url = new URL(req.url, 'http://stub');
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === '/__set') return send(res, 200, Object.assign(orders.get(body.order_id) ?? {}, body));
      if (url.pathname === '/__stats') return send(res, 200, stats);
      if (url.pathname === '/api/v1/authorization/') {
        stats.auth++;
        if (url.searchParams.get('merchant_token') !== 'e2e-inpay-token') return send(res, 401, { success: false });
        return send(res, 200, { success: true, bearer_token: 'stub-bearer' });
      }
      if (req.headers.authorization !== 'Bearer stub-bearer') return send(res, 401, { success: false });
      if (url.pathname === '/api/v1/create/' && req.method === 'POST') {
        const order_id = `e2e-${process.pid}-${++seq}`;
        orders.set(order_id, { order_id, status: 'pending', amount: body.amount });
        return send(res, 200, { success: true, order_id, pay_url: `http://127.0.0.1:${port}/pay/${order_id}` });
      }
      if (url.pathname === '/api/v1/transactions/') {
        const order = orders.get(url.searchParams.get('order_id'));
        return order ? send(res, 200, { success: true, data: order }) : send(res, 404, { success: false });
      }
      send(res, 404, {});
    });
  })
  .listen(port, '127.0.0.1');
// Never outlive the e2e run.
setInterval(() => {
  try {
    process.kill(parent, 0);
  } catch {
    process.exit(0);
  }
}, 1000);
STUB
  node "$WORK/inpay-stub.js" "$port" "$$" >"$WORK/inpay-stub.log" 2>&1 &
  stub_pid=$!
  for i in $(seq 1 50); do curl -s "http://127.0.0.1:$port/__stats" >/dev/null 2>&1 && break; sleep 0.1; done
  pp_stub() { curl -s -X POST "http://127.0.0.1:$port/$1" -H 'content-type: application/json' -d "$2"; }

  pp_checkout inpay 500000
  body=$(pp_json '.payUrl' <"$WORK/pp.txt")
  order="${body##*/}"
  [ "$body" = "http://127.0.0.1:$port/pay/$order" ] || fail "inPAY payUrl: $(cat "$WORK/pp.txt")"
  [ "$(pp_psql "SELECT status || ':' || amount FROM payment_transactions WHERE provider = 'inpay' AND external_id = '$order'")" = "pending:500000" ] \
    || fail "inPAY pending payment"
  # A forged "success" body changes nothing: the API still says pending.
  status=$(inpay_webhook "{\"order_id\":\"$order\",\"status\":\"success\",\"amount\":\"5000\"}")
  [ "$status" = "200" ] && [ "$(pp_balance)" = "200000" ] || fail "a forged inPAY webhook: HTTP $status, $(cat "$WORK/pp.txt")"
  pp_stub __set "{\"order_id\":\"$order\",\"status\":\"success\"}" >/dev/null
  # Five concurrent webhooks, then a repeated one: credited once.
  local pids=()
  for i in 1 2 3 4 5; do
    inpay_webhook "{\"order_id\":\"$order\"}" >/dev/null &
    pids+=($!)
  done
  wait "${pids[@]}"
  [ "$(inpay_webhook "{\"order_id\":\"$order\"}")" = "200" ] || fail "inPAY webhook: $(cat "$WORK/pp-hook.txt")"
  [ "$(pp_balance)" = "700000" ] || fail "wallet after inPAY: $(cat "$WORK/pp.txt")"
  [ "$(inpay_webhook '{"order_id":"e2e-unknown"}')" = "200" ] || fail "inPAY webhook for an unknown order"
  [ "$(inpay_webhook '{"order_id":"../x"}')" = "400" ] || fail "inPAY webhook with a bad order_id"
  # A cancelled order (one cached token for both checkouts), then an admin refund of the paid one.
  pp_checkout inpay 400000
  body=$(pp_json '.payUrl' <"$WORK/pp.txt")
  [ "$(pp_stub __stats '{}' | pp_json '.auth')" = "1" ] || fail "the inPAY token is not cached"
  pp_stub __set "{\"order_id\":\"${body##*/}\",\"status\":\"cancelled\"}" >/dev/null
  inpay_webhook "{\"order_id\":\"${body##*/}\"}" >/dev/null
  [ "$(pp_psql "SELECT status FROM payment_transactions WHERE provider = 'inpay' AND external_id = '${body##*/}'")" = "cancelled" ] \
    || fail "inPAY cancelled order"
  pp_call POST auth/sign-in "$(node -p 'JSON.stringify({ email: process.argv[1], password: process.argv[2] })' "$(pp_env ADMIN_EMAIL)" "$(pp_env ADMIN_PASSWORD)")"
  pp_expect 200 "admin sign-in"
  admin=$(pp_json '.accessToken' <"$WORK/pp.txt")
  pp_call POST "admin/payments/$(pp_psql "SELECT id FROM payment_transactions WHERE provider = 'inpay' AND external_id = '$order'")/cancel" \
    '{"refundedExternally":true,"comment":"e2e inPAY refund"}' "$admin"
  pp_expect 200 "admin cancel of a paid inPAY payment"
  [ "$(pp_balance)" = "200000" ] || fail "wallet after the inPAY refund: $(cat "$WORK/pp.txt")"
  kill "$stub_pid" 2>/dev/null || true
  log "Uzum, Paynet, inPAY OK"
}
