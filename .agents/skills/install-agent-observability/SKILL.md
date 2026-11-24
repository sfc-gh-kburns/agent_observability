---
name: install-agent-observability
description: Install, upgrade, reconfigure or uninstall Agent Observability (the AGENT_OBS data mart plus its Snowflake App Runtime app) in the user's Snowflake account. Runs a step-by-step setup wizard that asks for every account-specific setting, writes install.conf, runs deploy.sh and verifies the result. Use when the user says install, set up, deploy, configure, upgrade, update, reinstall or uninstall Agent Observability, or asks how to get this repo running in their account.
---

# Install Agent Observability

You are running the setup wizard for this repository. The user should never have
to edit a file by hand: ask, write `install.conf`, run `./deploy.sh`, verify, report.

Ground rules:
- Run everything from the repository root. All settings live in `install.conf`
  (gitignored, never commit it); `install.conf.example` documents every key.
- Ask with `ask_user_question`, at most 4 questions per call, always with defaults
  pre-filled. Before each question, tell the user in one line what it controls.
- Don't invent values. Discover connections, roles and warehouses with the commands
  below and offer what you find.
- Get an explicit "go" before step 5. It creates roles, warehouses, a database and
  account-level grants, and starts a scheduled pipeline that uses credits.
- If `install.conf` already exists, this is an upgrade or reconfigure: show the
  current values and ask only what the user wants to change.

## Step 1 — Prerequisites

Check, and tell the user plainly what is missing and how to fix it:

```bash
snow --version          # Snowflake CLI 3.x
node --version          # Node.js 20+ (the app is built with npm)
snow connection list    # at least one connection
```

If there's no connection, have the user add one (`! snow connection add`) and stop
until they have.

## Step 2 — Connection and admin role

Ask (one call):
1. **Connection** (`SNOW_CONNECTION`): offer the names from `snow connection list`,
   default the one marked default.
2. **Admin role** (`ADMIN_ROLE`, default `ACCOUNTADMIN`): it creates roles, two
   warehouses, the AGENT_OBS database and account grants (read access to
   ACCOUNT_USAGE, the AI observability event table, task execution). Any role that can
   grant those works; ACCOUNTADMIN is simplest.

Then run the preflight with a temporary config (`SNOW_CONNECTION` and `ADMIN_ROLE`
only) and show the result:

```bash
./deploy.sh --config install.conf --check
```

It checks the tools, that SQL runs as the admin role, and that Snowflake App Runtime
is available. Fix any failure before continuing.

## Step 3 — Look around the account

Run these and use the results as options in step 4 (keep the outputs short):

```sql
SHOW WAREHOUSES;                          -- offer existing warehouses, or a new one
SHOW ROLES;                               -- candidate viewer / content roles
SHOW APPLICATION SERVICES IN ACCOUNT;     -- an existing install, or name clashes
SHOW DATABASES LIKE 'AGENT_OBS';          -- already installed? then it's an upgrade
```

## Step 4 — Questions

Ask in this order (group into calls of up to 4). Explain cost-related ones in a sentence.

**Pipeline**
- `PIPELINE_WAREHOUSE` (default `AGENT_OBS_WH`, created if missing) and
  `PIPELINE_WAREHOUSE_SIZE` (default `XSMALL`; larger is rarely needed).
- `PIPELINE_SCHEDULE`. Options: every 12 hours (`USING CRON 0 */12 * * * UTC`,
  default, about 0.15-0.2 credits a day), every 6 hours (`USING CRON 0 */6 * * * UTC`),
  hourly (`USING CRON 0 * * * * UTC`, freshest, a few times the cost).
- `CLASSIFIER_MODEL` (default `claude-haiku-4-5`): classifies each distinct question
  once for the Trends page. Check the model is available in their region with
  `SELECT AI_COMPLETE('<model>', 'hi');` before accepting another value.
- `BACKFILL_START` (default `2020-01-01`, meaning everything still available).
- `CREDIT_PRICE_USD` (optional, blank shows credits only).

**App**
- `APP_DATABASE` / `APP_SCHEMA` / `APP_NAME` (defaults `AGENT_OBS_APPS` / `PUBLIC` /
  `AGENT_OBSERVABILITY`). Created if missing. If they already deploy apps into a
  database (look at step 3), offer that.
- `APP_WAREHOUSE` (default `AGENT_OBS_APP_WH`, created if missing; offer an existing
  app warehouse if they have one) and `APP_WAREHOUSE_SIZE` (default `XSMALL`).
- `APP_OWNER_ROLE` (default the admin role): deploys and owns the app.
- `APP_AUTO_SUSPEND_SECS` (default `3600`): idle time before the app stops; `0`
  keeps it running all the time, which costs more.

**Access**
- `VIEWER_ROLES`: comma-separated roles that may open the app and see metrics.
- `CONTENT_ROLES`: comma-separated roles that may also read questions, answers, SQL
  and feedback text. Say clearly that this exposes conversation content; default empty.

Every identifier must be a plain name (letters, digits, `_`, `$`); `deploy.sh`
rejects anything else. Upper-case what the user types.

## Step 5 — Confirm and write

Show a compact summary table of every setting and what will be created, then ask for
a go-ahead. On yes, write `install.conf` from `install.conf.example` with the chosen
values (keep the comments). Never write credentials into it.

## Step 6 — Install

Run the steps one at a time so progress is visible and failures are easy to place:

```bash
./deploy.sh --mart        # roles, warehouse, AGENT_OBS database, pipeline objects (a few minutes)
./deploy.sh --backfill    # first load of all available history (minutes on a busy account)
./deploy.sh --start       # start the scheduled pipeline
./deploy.sh --app         # app grants, build and deploy the app, viewer/content grants
```

Use a long timeout for `--mart`, `--backfill` and `--app` (up to 30 minutes each).
On failure, read the error, fix the cause (usually a missing privilege, an unavailable
model or a name clash), and re-run the same step; every step is idempotent.

## Step 7 — Verify and hand over

```sql
SELECT * FROM AGENT_OBS.MART.V_FRESHNESS ORDER BY source;   -- rows and data-through per source
SHOW TASKS LIKE 'T_AGENT_OBS_ROOT' IN SCHEMA AGENT_OBS.ADMIN; -- state = started
```

Then tell the user, briefly:
- the app URL (printed by `--app`), and that the first page load can take a minute;
- which roles can open it and which can read conversation content;
- that ACCOUNT_USAGE data lags 45 minutes to 3 hours, so a brand-new account may
  look sparse at first, and the Docs page in the app explains every number;
- what it costs: the pipeline schedule they picked, plus the app's runtime while it
  is running (auto-suspend setting).

## Upgrade or reconfigure

`git pull`, then run the wizard again: with an existing `install.conf`, ask only
what to change, then run `./deploy.sh --mart --start --app` (add `--backfill` only
if `BACKFILL_START` moved earlier). `--mart` recreates the tasks, so always include
`--start` with it.

## Grant access later

Add the roles to `VIEWER_ROLES` / `CONTENT_ROLES` in `install.conf` and run
`./deploy.sh --app`.

## Uninstall

Only on explicit request, after showing exactly what will be dropped and getting a
yes. This deletes all collected history, which can't be recovered from Snowflake once
ACCOUNT_USAGE has aged out:

```sql
CALL AGENT_OBS.ADMIN.SP_SET_SCHEDULE(FALSE);            -- as AGENT_OBS_INGEST_ROLE
DROP APPLICATION SERVICE <APP_DATABASE>.<APP_SCHEMA>.<APP_NAME>;
DROP DATABASE AGENT_OBS;
DROP ROLE AGENT_OBS_APP_ROLE; DROP ROLE AGENT_OBS_CONTENT_ROLE; DROP ROLE AGENT_OBS_INGEST_ROLE;
DROP WAREHOUSE <PIPELINE_WAREHOUSE>;                      -- only if the installer created it
```

Leave `APP_DATABASE` and `APP_WAREHOUSE` alone unless the user confirms nothing else
uses them.
