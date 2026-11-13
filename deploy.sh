#!/usr/bin/env bash
# Deploy the AGENT_OBS mart end to end (idempotent).
#   ./deploy.sh <snow-connection> [--backfill] [--start]
# 00 runs as ACCOUNTADMIN; everything else as AGENT_OBS_INGEST_ROLE.
# 05 must run after 03/04: CREATE OR REPLACE DYNAMIC TABLE drops masking policies.
set -euo pipefail
CONN="${1:?usage: ./deploy.sh <connection> [--backfill] [--start]}"; shift || true
DIR="$(cd "$(dirname "$0")" && pwd)/sql"

for f in 00_setup 01_raw 02_load_procs 03_core 04_mart 05_policies 06_tasks; do
  echo "==> $f"
  snow sql -c "$CONN" -f "$DIR/$f.sql" >/dev/null
done

run() { snow sql -c "$CONN" --role AGENT_OBS_INGEST_ROLE --warehouse AGENT_OBS_WH -q "$1"; }

for arg in "$@"; do
  case "$arg" in
    --backfill)
      echo "==> backfill"
      run "CALL AGENT_OBS.ADMIN.SP_LOAD_USAGE(); CALL AGENT_OBS.ADMIN.SP_LOAD_EVENTS();
           CALL AGENT_OBS.ADMIN.SP_LOAD_AGENT_CONFIG(); CALL AGENT_OBS.ADMIN.SP_LOAD_ASSETS();
           CALL AGENT_OBS.ADMIN.SP_LOAD_USERS(); CALL AGENT_OBS.ADMIN.SP_LOAD_QUERY_HISTORY();
           CALL AGENT_OBS.ADMIN.SP_LOAD_CODE_USAGE(); CALL AGENT_OBS.ADMIN.SP_LOAD_AI_FUNCTION_USAGE();
           CALL AGENT_OBS.ADMIN.SP_REFRESH_MART(TRUE);" ;;
    --start)
      echo "==> start pipeline"
      run "CALL AGENT_OBS.ADMIN.SP_SET_SCHEDULE(TRUE);" ;;
  esac
done
echo "done"
