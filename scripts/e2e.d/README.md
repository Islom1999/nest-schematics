# Add-on e2e steps

`scripts/e2e.sh` sources every `*.sh` file here, in name order, inside the generated
project, once for the first run and once more with `E2E_RERUN=1` (the re-run must not
change any file).

One file per add-on, numbered by dependency order, for example:

```bash
# 20-upload.sh
run_g upload --storage local --skip-install
```

Available helpers: `run_g <args>`, `has_script <name>`, `log`, `fail`, `$WORK`, `$API_PORT`.
Smoke checks against the running API can be appended to `E2E_SMOKE` (a shell snippet).
