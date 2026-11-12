# Seeds: a generated seed is registered, and `npm run seed` runs it against the
# e2e database (all seeds, then one by name) once the API has migrated it.
run_g seed demo-data --dev-only --skip-install
run_g seed reference-data --skip-install

if [ -z "${E2E_RERUN:-}" ]; then
  E2E_SMOKE="${E2E_SMOKE:-}
log 'npm run seed'
npm run --silent seed | tee \"\$WORK/seed.log\"
grep -q 'Done: demo-data, reference-data' \"\$WORK/seed.log\" || fail 'npm run seed did not run every seeder.'
npm run --silent seed -- demo-data | grep -q 'Done: demo-data' || fail 'npm run seed -- demo-data failed.'
NODE_ENV=production npm run --silent seed | grep -q 'skip demo-data' || fail 'devOnly seed ran in production.'
"
fi
