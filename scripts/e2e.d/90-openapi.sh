# S11 Swagger contract + openapi-client add-on.
run_g openapi-client --name admin --doc admin --generator typescript-angular --target ../admin-client --skip-install

if [ -z "${E2E_RERUN:-}" ]; then
  # Runs after the API boots: the export must not need a database, must match
  # what /docs serves, and must carry clean operationIds.
  E2E_SMOKE="${E2E_SMOKE:-}
log 'OpenAPI: export without a database'
DB_HOST=127.0.0.1 DB_PORT=1 DB_PASSWORD=wrong npm run --silent swagger:export -- \"\$WORK/openapi-nodb\"
for doc in admin client; do
  cmp -s \"openapi/\$doc.json\" \"\$WORK/openapi-nodb/\$doc.json\" || fail \"openapi/\$doc.json differs from the export without a database\"
  curl -fsS \"http://localhost:\$API_PORT/docs/\$doc-json\" -o \"\$WORK/served-\$doc.json\" || fail \"/docs/\$doc-json not served\"
  node -e 'const a=JSON.stringify(require(process.argv[1]));const b=JSON.stringify(require(process.argv[2]));if(a!==b){console.error(\"served != exported\");process.exit(1)}' \"\$PWD/openapi/\$doc.json\" \"\$WORK/served-\$doc.json\" || fail \"/docs/\$doc-json differs from openapi/\$doc.json\"
done
node -e '
const admin = require(process.argv[1]), client = require(process.argv[2]);
const ids = (d) => Object.values(d.paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
const a = ids(admin), c = ids(client);
for (const id of [\"productFindAll\", \"productFindAllPagination\", \"productCreate\", \"authSignIn\"]) if (!a.includes(id)) throw new Error(\"admin: missing \" + id);
if (Object.keys(admin.paths).some((p) => !/^\\/api\\/(admin|auth)(\\/|$)/.test(p))) throw new Error(\"admin has non-admin paths\");
if (Object.keys(client.paths).some((p) => /^\\/api\\/(admin|auth)(\\/|$)/.test(p))) throw new Error(\"client has admin paths\");
if (new Set([...a, ...c]).size !== a.length + c.length) throw new Error(\"duplicate operationIds\");
if (!admin.components.securitySchemes.bearer) throw new Error(\"no bearer scheme\");
console.log(\"operationIds ok: \" + a.length + \" admin, \" + c.length + \" client\");
' \"\$PWD/openapi/admin.json\" \"\$PWD/openapi/client.json\" || fail 'OpenAPI contract check failed'
code=\$(curl -s -o /dev/null -w '%{http_code}' \"http://localhost:\$API_PORT/docs\")
[ \"\$code\" = 200 ] || fail \"/docs returned \$code\"
"
fi
