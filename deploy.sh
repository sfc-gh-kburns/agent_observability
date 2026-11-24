#!/usr/bin/env bash
# =====================================================================
# Agent Observability installer (idempotent; safe to re-run for upgrades).
#
#   ./deploy.sh [--config install.conf] <steps...>
#
# Steps (run in this order when several are given):
#   --check      Preflight: tools, connection, admin role, App Runtime.
#   --mart       Create or upgrade the AGENT_OBS data mart (sql/00..09).
#   --backfill   Load all history still available in Snowflake.
#   --start      Start the pipeline on PIPELINE_SCHEDULE.
#   --app        Deploy the app and grant VIEWER_ROLES / CONTENT_ROLES.
#   --all        All of the above.
#
# Every setting comes from the config file (default ./install.conf); see
# install.conf.example. The CoCo install wizard writes it for you.
# Legacy form, still supported: ./deploy.sh <connection> [--backfill] [--start]
# =====================================================================
set -eo pipefail   # no -u: macOS bash 3.2 treats empty arrays as unbound
ROOT="$(cd "$(dirname "$0")" && pwd)"
SQL="$ROOT/sql"
APP_DIR="$ROOT/agent-observability"
CONFIG="$ROOT/install.conf"
STEPS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --config) CONFIG="$2"; shift 2 ;;
    --check|--mart|--backfill|--start|--app) STEPS+=("$1"); shift ;;
    --all) STEPS+=(--check --mart --backfill --start --app); shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) LEGACY_CONNECTION="$1"; shift ;;
  esac
done

# Defaults (same as install.conf.example), then the config file.
ADMIN_ROLE="ACCOUNTADMIN"
PIPELINE_WAREHOUSE="AGENT_OBS_WH"; PIPELINE_WAREHOUSE_SIZE="XSMALL"
PIPELINE_SCHEDULE="USING CRON 0 */12 * * * UTC"; BACKFILL_START="2020-01-01"
CLASSIFIER_MODEL="claude-haiku-4-5"; CREDIT_PRICE_USD=""
APP_DATABASE="AGENT_OBS_APPS"; APP_SCHEMA="PUBLIC"; APP_NAME="AGENT_OBSERVABILITY"
APP_WAREHOUSE="AGENT_OBS_APP_WH"; APP_WAREHOUSE_SIZE="XSMALL"
APP_OWNER_ROLE="ACCOUNTADMIN"; APP_AUTO_SUSPEND_SECS="3600"
VIEWER_ROLES=""; CONTENT_ROLES=""; SNOW_CONNECTION=""
if [ -f "$CONFIG" ]; then
  # shellcheck disable=SC1090
  . "$CONFIG"
elif [ -z "${LEGACY_CONNECTION:-}" ]; then
  echo "No config at $CONFIG. Copy install.conf.example to install.conf (or run the CoCo install wizard)." >&2
  exit 2
fi
if [ -n "${LEGACY_CONNECTION:-}" ]; then
  SNOW_CONNECTION="$LEGACY_CONNECTION"
  [ ${#STEPS[@]} -eq 0 ] && STEPS=(--mart)
  case " ${STEPS[*]} " in *" --mart "*) ;; *) STEPS=(--mart "${STEPS[@]}") ;; esac
fi
[ ${#STEPS[@]} -eq 0 ] && { sed -n '2,19p' "$0"; exit 2; }
: "${SNOW_CONNECTION:?SNOW_CONNECTION is not set in $CONFIG}"

# Identifiers go straight into SQL, so only allow plain names.
ident() { [[ "$2" =~ ^[A-Za-z_][A-Za-z0-9_$]*$ ]] || { echo "$1 must be a plain identifier, got: '$2'" >&2; exit 2; }; }
for v in ADMIN_ROLE PIPELINE_WAREHOUSE PIPELINE_WAREHOUSE_SIZE APP_DATABASE APP_SCHEMA APP_NAME APP_WAREHOUSE APP_WAREHOUSE_SIZE APP_OWNER_ROLE; do
  ident "$v" "${!v}"
done
roles() { local IFS=','; for r in $1; do r="$(echo "$r" | xargs)"; [ -z "$r" ] && continue; ident "role" "$r"; echo "$r"; done; }
VIEWERS=$(roles "$VIEWER_ROLES"); CONTENTS=$(roles "$CONTENT_ROLES")
[[ "$APP_AUTO_SUSPEND_SECS" =~ ^[0-9]+$ ]] || { echo "APP_AUTO_SUSPEND_SECS must be a number" >&2; exit 2; }
[[ "$BACKFILL_START" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "BACKFILL_START must be YYYY-MM-DD" >&2; exit 2; }
sq() { printf "%s" "$1" | sed "s/'/''/g"; }   # escape a SQL string literal

VARS=(-D "admin_role=$ADMIN_ROLE" -D "pipeline_warehouse=$PIPELINE_WAREHOUSE" -D "pipeline_warehouse_size=$PIPELINE_WAREHOUSE_SIZE"
      -D "app_database=$APP_DATABASE" -D "app_schema=$APP_SCHEMA" -D "app_warehouse=$APP_WAREHOUSE"
      -D "app_warehouse_size=$APP_WAREHOUSE_SIZE" -D "app_owner_role=$APP_OWNER_ROLE")
sqlfile() { echo "  - $1"; snow sql -c "$SNOW_CONNECTION" "${VARS[@]}" -f "$SQL/$1.sql" >/dev/null; }
ingest()  { snow sql -c "$SNOW_CONNECTION" --role AGENT_OBS_INGEST_ROLE --warehouse "$PIPELINE_WAREHOUSE" -q "$1"; }
admin()   { snow sql -c "$SNOW_CONNECTION" --role "$ADMIN_ROLE" -q "$1"; }

step_check() {
  echo "==> preflight"
  local ok=1
  for t in snow node npm; do command -v "$t" >/dev/null || { echo "  ✗ $t not found"; ok=0; }; done
  [ $ok = 1 ] && echo "  ✓ snow, node and npm found"
  if snow sql -c "$SNOW_CONNECTION" --role "$ADMIN_ROLE" -q "SELECT CURRENT_ACCOUNT_NAME(), CURRENT_USER()" >/dev/null 2>&1; then
    echo "  ✓ connection '$SNOW_CONNECTION' works with role $ADMIN_ROLE"
  else
    echo "  ✗ cannot run SQL as $ADMIN_ROLE on connection '$SNOW_CONNECTION'"; ok=0
  fi
  if snow sql -c "$SNOW_CONNECTION" --role "$ADMIN_ROLE" -q "SHOW APPLICATION SERVICES LIMIT 1" >/dev/null 2>&1; then
    echo "  ✓ Snowflake App Runtime is available"
  else
    echo "  ✗ SHOW APPLICATION SERVICES failed: Snowflake App Runtime may not be enabled in this account"; ok=0
  fi
  [ $ok = 1 ] || { echo "preflight failed" >&2; exit 1; }
}

step_mart() {
  echo "==> data mart"
  # 05 after 03/04: CREATE OR REPLACE DYNAMIC TABLE drops masking policies.
  # 08/09 before 06: the task graph calls SP_REFRESH_TRENDS and SP_LOAD_AUTOMATIONS.
  for f in 00_setup 01_raw 02_load_procs 03_core 04_mart 05_policies 08_trends 09_automations 06_tasks; do sqlfile "$f"; done
  echo "  - settings"
  ingest "UPDATE AGENT_OBS.ADMIN.CONFIG SET VALUE = CASE KEY
            WHEN 'PIPELINE_SCHEDULE' THEN '$(sq "$PIPELINE_SCHEDULE")'
            WHEN 'BACKFILL_START'    THEN '$(sq "$BACKFILL_START")'
            WHEN 'CLASSIFIER_MODEL'  THEN '$(sq "$CLASSIFIER_MODEL")'
            WHEN 'CREDIT_PRICE_USD'  THEN '$(sq "$CREDIT_PRICE_USD")' END,
            UPDATED_AT = CURRENT_TIMESTAMP()
          WHERE KEY IN ('PIPELINE_SCHEDULE', 'BACKFILL_START', 'CLASSIFIER_MODEL', 'CREDIT_PRICE_USD');" >/dev/null
  # CREATE OR REPLACE TASK leaves the graph suspended; restart it if it was running.
  case " ${STEPS[*]} " in *" --start "*) ;; *) echo "  (pipeline is suspended until you run --start)";; esac
}

step_backfill() {
  echo "==> backfill (can take several minutes on a busy account)"
  ingest "CALL AGENT_OBS.ADMIN.SP_LOAD_USAGE(); CALL AGENT_OBS.ADMIN.SP_LOAD_EVENTS();
          CALL AGENT_OBS.ADMIN.SP_LOAD_AGENT_CONFIG(); CALL AGENT_OBS.ADMIN.SP_LOAD_ASSETS();
          CALL AGENT_OBS.ADMIN.SP_LOAD_USERS(); CALL AGENT_OBS.ADMIN.SP_LOAD_QUERY_HISTORY();
          CALL AGENT_OBS.ADMIN.SP_LOAD_CODE_USAGE(); CALL AGENT_OBS.ADMIN.SP_LOAD_AI_FUNCTION_USAGE();
          CALL AGENT_OBS.ADMIN.SP_LOAD_AUTOMATIONS();
          CALL AGENT_OBS.ADMIN.SP_REFRESH_MART(TRUE); CALL AGENT_OBS.ADMIN.SP_REFRESH_TRENDS();" >/dev/null
}

step_start() {
  echo "==> start pipeline ($PIPELINE_SCHEDULE)"
  ingest "CALL AGENT_OBS.ADMIN.SP_SET_SCHEDULE(TRUE);" >/dev/null
}

# Point app.yml at the configured location (only the keys below change).
write_app_yml() {
  local f="$APP_DIR/app.yml" tmp
  tmp="$(mktemp)"
  awk -v n="$APP_NAME" -v d="$APP_DATABASE" -v s="$APP_SCHEMA" -v w="$APP_WAREHOUSE" -v a="$APP_AUTO_SUSPEND_SECS" '
    /^name:/ {print "name: " n; next}
    /^database:/ {print "database: " d; next}
    /^schema:/ {print "schema: " s; next}
    /^query_warehouse:/ {print "query_warehouse: " w; next}
    /^auto_suspend_secs:/ {print "auto_suspend_secs: " a; seen=1; next}
    {print}
    END {if (!seen) print "auto_suspend_secs: " a}' "$f" > "$tmp" && mv "$tmp" "$f"
}

step_app() {
  echo "==> app grants"
  sqlfile 07_app_grants
  echo "==> deploy app to $APP_DATABASE.$APP_SCHEMA.$APP_NAME"
  # app.yml is tracked with generic defaults; fill in this account's values only
  # for the deploy so they never end up in git.
  cp "$APP_DIR/app.yml" "$APP_DIR/.app.yml.orig"
  trap 'mv -f "$APP_DIR/.app.yml.orig" "$APP_DIR/app.yml"' EXIT
  write_app_yml
  (cd "$APP_DIR" && snow app deploy -c "$SNOW_CONNECTION" --role "$APP_OWNER_ROLE")
  mv -f "$APP_DIR/.app.yml.orig" "$APP_DIR/app.yml"; trap - EXIT
  local fqn="$APP_DATABASE.$APP_SCHEMA.$APP_NAME"
  for r in $VIEWERS; do
    echo "  - viewer role $r"
    admin "GRANT ROLE AGENT_OBS_APP_ROLE TO ROLE $r;" >/dev/null
    snow sql -c "$SNOW_CONNECTION" --role "$APP_OWNER_ROLE" -q "GRANT USAGE ON APPLICATION SERVICE $fqn TO ROLE $r;" >/dev/null
  done
  for r in $CONTENTS; do
    echo "  - content role $r"
    admin "GRANT ROLE AGENT_OBS_CONTENT_ROLE TO ROLE $r; GRANT ROLE AGENT_OBS_APP_ROLE TO ROLE $r;" >/dev/null
    snow sql -c "$SNOW_CONNECTION" --role "$APP_OWNER_ROLE" -q "GRANT USAGE ON APPLICATION SERVICE $fqn TO ROLE $r;" >/dev/null
  done
  snow sql -c "$SNOW_CONNECTION" --role "$APP_OWNER_ROLE" -q "SHOW APPLICATION SERVICES LIKE '$APP_NAME' IN SCHEMA $APP_DATABASE.$APP_SCHEMA;
    SELECT \"url\" AS APP_URL, \"status\" AS STATUS FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));" | tail -4
}

for s in --check --mart --backfill --start --app; do
  case " ${STEPS[*]} " in *" $s "*) "step_${s#--}" ;; esac
done
echo "done"
