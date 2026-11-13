# Agent Observability for Snowflake Cortex Agents

Cross-agent observability for every **Cortex Agent** and **Snowflake CoWork** interaction in a Snowflake account. It covers usage, authoritative cost, quality, configuration history and Snowsight-style trace drill-down.

| Path | What |
| --- | --- |
| [`REQUIREMENTS.md`](REQUIREMENTS.md) | Product requirements (v0.1) |
| [`sql/`](sql) | `AGENT_OBS` data mart: roles and grants, RAW history tables, load procedures, CORE/MART dynamic tables, content-tier masking policies, task graph |
| [`deploy.sh`](deploy.sh) | Runs the SQL in order (`./deploy.sh <connection> [--backfill] [--start]`) |
| [`agent-observability/`](agent-observability) | Snowflake App Runtime (Next.js) app over `AGENT_OBS.MART`. See its README. |

## Architecture

```
ACCOUNT_USAGE agent/CoWork usage ─┐
SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS ─┼─► RAW (never purged) ─► CORE (dynamic tables) ─► MART ─► SAR app (caller's rights)
SHOW/DESCRIBE AGENTS, semantic views ─┘        task graph every 12 h
```

- RAW keeps full history, so data outlives the source views' retention.
- Agent config is captured as SCD2 snapshots.
- Questions, responses, SQL and feedback text are masked unless the viewer has `AGENT_OBS_CONTENT_ROLE`.

## Setup

1. Run `./deploy.sh <connection> --backfill --start` as ACCOUNTADMIN. This creates the roles, the `AGENT_OBS` database and warehouse, loads history, and starts the 12-hourly pipeline.
2. Run `sql/07_app_grants.sql` (caller grants for the app's owning role).
3. Deploy the app: `cd agent-observability && snow app setup --app-name=agent_observability && snow app deploy`. Set `database`, `schema` and `query_warehouse` in `app.yml` to match your account.

No credentials are stored in this repo. Local dev uses your Snowflake CLI profile (`SNOWFLAKE_CONNECTION_NAME`), and the deployed app uses the platform token.
