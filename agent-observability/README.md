# Agent Observability

A Snowflake App Runtime (Next.js) app for cross-agent observability of every **Cortex Agent** and **Snowflake CoWork** interaction in the account:

| Page | What it answers |
| --- | --- |
| **Portfolio** (`/`) | Turns, threads, users, AI credits, tokens/cache, p50/p95 latency, success and feedback, all with period-over-period deltas. Daily trend by interface, agent leaderboard with idle / cost-outlier / regression flags, interface mix, credits by model, adoption funnel. |
| **Agent** (`/agent?fqn=…`) | Config badges (model, budget, tools, web search, code execution, …), usage with config-change markers, tool usage and planning depth, bound tools and resources, top users, failed and recent turns, SCD2 configuration history with spec diffs. |
| **Threads** (`/threads`) | Search by thread id, request id, user or question text. "Problems only" filter. |
| **Thread** (`/thread?id=…`) | Chat transcript (rendered markdown) with per-turn badges. For each turn: time split, a Gantt span waterfall with a span inspector (planning, SQL, search, chart, raw JSON), SQL executions with verified-query use and warehouse metrics, an authoritative cost panel from the usage views, and JSON export. |
| **Config** (`/config`) | Every agent with capability and governance flags, plus a cross-agent config change log. |
| **Assets** (`/assets`) | Semantic views and search services: bound in config vs used in traces, shared across ≥ 2 agents, bound but unused, bound but missing. |
| **Admin** (`/admin`) | Data freshness, pipeline runs, and your access tier. |

All time ranges and filters live in the URL, so every view is a shareable link.

## Data

The app reads **only `AGENT_OBS.MART`**, built by the pipeline in `../sql` (RAW → CORE → MART, refreshed every 12 h). Named queries are in `lib/queries.ts`; all user input is passed as bind variables.

## Access model

Every query runs with **caller's rights** (`app/api/q/[name]/route.ts` → `withCaller`), so Snowflake's masking policies decide what each viewer sees:

| Viewer has | Sees |
| --- | --- |
| `AGENT_OBS_APP_ROLE` | Metadata: counts, cost, latency, tool names, config |
| `AGENT_OBS_CONTENT_ROLE` | Also questions, responses, SQL, search queries and results, and feedback text (each view is logged to `ADMIN.CONTENT_ACCESS_AUDIT`) |

Required grants are in `../sql/07_app_grants.sql` (caller grants on the owning role, plus warehouse usage); `../deploy.sh --app` applies them and grants the roles in `VIEWER_ROLES` / `CONTENT_ROLES`. To grant by hand:

```sql
GRANT USAGE ON APPLICATION SERVICE <app_database>.<app_schema>.<app_name> TO ROLE <role>;
GRANT ROLE AGENT_OBS_APP_ROLE TO ROLE <role>;        -- metadata tier
-- GRANT ROLE AGENT_OBS_CONTENT_ROLE TO ROLE <role>; -- content tier (approved roles only)
```

## Run locally

```bash
npm install
SNOWFLAKE_CONNECTION_NAME=<connections.toml profile> npm run dev
```

`SNOWFLAKE_CONNECTION_NAME` is honoured only under `next dev`. The deployed app always uses the platform token. Locally, caller's rights runs as your connection, so you see your own tier.

Checks: `npm test` (route-free unit tests, including bind-count and injection guards for every named query) and `npx tsc --noEmit`.

## Deploy

Deploy with `../deploy.sh --app`. It reads the app's database, schema, name, warehouse and auto-suspend from `../install.conf` and writes them into `app.yml` only for the duration of the deploy; the committed `app.yml` holds generic defaults.

Pitfalls:

- Don't run `node .next/standalone/server.js` locally, because static assets 404. Use `npm run dev` or `npm run start`.
- Keep the `turbopack.root` / `outputFileTracingRoot` pin in `next.config.mjs`.
- A v2 deploy is declarative: `ALTER APPLICATION SERVICE … SET` changes are reverted unless they are in `app.yml`.
- ARRAY and OBJECT columns must be cast `::VARIANT` in queries, because the SDK's JSON format rejects them.
