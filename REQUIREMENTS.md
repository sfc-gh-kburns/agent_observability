# Agent Observability App — Requirements (v0.1)

| | |
|---|---|
| **Owner** | Kyle Burns |
| **Platform** | Snowflake App Runtime (SAR) — Snowflake App (APPLICATION SERVICE) |
| **Status** | Draft v0.1 — first requirements pass |
| **Date** | 2026-11-12 |
| **Grounding account** | Snowflake demo account (33 agents, ~4.4K agent requests in last 30 days) |

---

## 1. Purpose

Build a single observability application for every Cortex Agent and Snowflake CoWork (formerly Snowflake Intelligence) interaction in the account. It must work at three altitudes:

1. **Strategic (portfolio)** — Which agents matter, what are people asking, what does it cost, is it getting better or worse, where are the gaps?
2. **Operational (agent / theme / asset)** — For one agent, theme, semantic view, or search service: volume, quality, latency, cost, failure modes, and who uses it.
3. **Forensic (thread → turn → span)** — Re-create the same trace detail Snowsight's Agent → Observability tab shows (planning steps, tool calls, SQL, search results, charts, response, feedback), and go beyond it by joining authoritative cost and agent configuration.

The defining capability that Snowsight does **not** provide: **cross-agent analysis** — themes, shared semantic views/search services, feedback, and cost compared across all agents at once.

## 2. Goals & Non-Goals

### Goals
- G1. One pane of glass for **all interfaces**: CoWork UI, Agent REST API, SQL function (`sql_function`), MCP, Microsoft Teams, agent admin UI, scheduled/triggered runs.
- G2. Authoritative **tokens & credits** per turn, per thread, per user, per agent, per model, per service type.
- G3. **Question intelligence**: cluster questions into themes, rank them by volume/growth/failure/negative feedback, and compare themes across agents.
- G4. **Asset intelligence**: which semantic views, Cortex Search services, verified queries, tools, and skills are used, by which agents, how often, and how well.
- G5. **Config intelligence**: current and historical agent configuration (models, budget, tools, web search, sandbox/code execution, instructions, versions) linked to behavior.
- G6. **Trace drill-down** equal to Snowsight Observability, for any thread or turn.
- G7. **Feedback & user** insight: who uses what, satisfaction, repeat use, and churn.

### Non-Goals (v1)
- Running evaluations (`EXECUTE_AI_EVALUATION`) — link out only; may ingest results in v2.
- Changing agents (editing specs) from the app.
- Snowflake CoCo session analytics (CoCo spans `CodingAgentRun` / `CodingAgent.Step-N` are in the same event table; **exclude** them by default, optional later tab).
- Multiple accounts (`ORGANIZATION_USAGE`) — design for it, ship single-account first.

## 3. Personas

| Persona | Primary questions | Altitude |
|---|---|---|
| **AI Platform Owner / CoE lead** | Adoption, ROI, cost trend, which agents to invest in or retire, governance | Strategic |
| **Agent Builder** | Why did my agent fail/answer badly? Which tools were picked? Which verified queries hit? What changed between versions? | Operational + Forensic |
| **Semantic Model / Data Owner** | Which agents use my semantic view? Which questions hit it? Where does SQL fail? Which verified queries to add? | Operational |
| **FinOps** | Credits by agent/user/team/model, outliers, forecasts | Strategic + Operational |
| **Security / Governance** | Who asked what, with which role, what data was touched, web search / code execution usage | Forensic |
| **Business Sponsor** | What are my users asking about? Are they satisfied? | Strategic |

## 4. Source Data (verified in account)

All sources below were inspected in this account on 2026-11-12. Attribute names are as observed; treat as **semi-structured and evolving** (see §11 risks).

### 4.1 Authoritative usage & cost (ACCOUNT_USAGE, ~1 h latency, 1 yr retention)

| Source | Grain | Key fields |
|---|---|---|
| `SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY` | 1 row / turn via CoWork UI | `REQUEST_ID`, `PARENT_REQUEST_ID`, `USER_ID/NAME`, `SNOWFLAKE_COWORK_ID/NAME`, `AGENT_*`, `TOKENS`, `TOKEN_CREDITS`, `TOKENS_GRANULAR`, `CREDITS_GRANULAR`, `METADATA`, `USER_TAGS`, `AGENT_TAGS` |
| `SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_USAGE_HISTORY` | 1 row / turn via all other interfaces | Same, plus `METADATA:interaction_interface` |
| `SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_INTELLIGENCE_USAGE_HISTORY` | Legacy name of CoWork view | Back-fill only |

The two primary views are **mutually exclusive** (a CoWork turn is not duplicated in the agent view) → safe to `UNION ALL`.

**`TOKENS_GRANULAR` / `CREDITS_GRANULAR` shape (verified):**
```json
[ { "<sub_request_uuid>": {
      "cortex_agents": { "claude-opus-5-5": {"input":8,"output":1035,"cache_read_input":39043,"cache_write_input":42636} },
      "start_time": "2026-10-26 09:00:20.695 -0700" } } ]
```
Array of steps → keyed by sub-request → service_type → model → token/credit counts. Must flatten 4 levels; **do not** use `[0]:model` (returns NULL).

**`METADATA` keys (verified):** `agent_version_id`, `agent_version_name`, `agent_version_alias`, `agent_version_is_default`, `ai_functions_credits`, `sql_query_credits`, `sql_query_warehouses`, `inference_region`, `role_id`, `role_name`, `interaction_interface` (agent view), `trigger_type` (CoWork view, e.g. `manual`).

### 4.2 Trace / content (SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS)

OpenTelemetry-style event table. Hierarchy (per docs): **Snowflake session → Thread (`thread_id`) → Turn = Trace (`TRACE:trace_id`) → Spans**.

Common attributes on every agent span: `snow.ai.observability.agent.thread_id`, `…agent.message_id`, `ai.observability.record_id`, `ai.observability.input_id`, `…database.name`, `…schema.name`, `…object.name` (agent), `…object.type` (`Cortex Agent`), `…object.version.id/name`. `RESOURCE_ATTRIBUTES`: `snow.user.id/name`, `snow.session.id`, `snow.session.role.primary.id/name`.

| Span / record `RECORD:name` | Purpose | Key attributes (observed) |
|---|---|---|
| `CORTEX_AGENT_REQUEST` (EVENT) | Turn header | `user.id/name`, `role.id/name`, `session.id`, `token_count.{input,output,cache_read_input,cache_write_input,total}`, `parent_message_id` |
| `Agent` | Root span | `request_id` |
| `AgentV2RequestResponseInfo` | Turn summary — **primary content record** | `agent.request_id` (**join key → usage views `REQUEST_ID`**), `record_root.input` (question), `agent.response`, `agent.thinking_response`, `agent.first_message_in_thread`, `agent.thread_id.messages`, `agent.parent_message_id`, `agent.duration`, `agent.status(.code/.description)`, `agent.research_mode`, `agent.suggested_queries`, `agent.tool_choice.type` |
| `AgentPassthroughRequestResponseInfo` | Passthrough turn variant | (treat as turn summary; confirm fields) |
| `ReasoningAgentStepPlanning-N` | Orchestration/planning step N | `planning.model`, `planning.step_number`, `planning.duration`, `planning.token_count.*` (incl. `plan`), `planning.tool_selection.{name,type,argument.*}`, `planning.thinking_response`, `planning.status` |
| `ReasoningAgentStepResponseGeneration-N` | Final answer generation | `planning.model`, token counts, duration, response |
| `SystemExecuteSQLTool_system_execute_sql`, `SqlExecution*` | Analyst SQL execution | `cortex_analyst.semantic_model`, `sql_execution.analyst_tool_name`, `final_sql`, `query_id` (→ `QUERY_HISTORY`), `verified_query_used`, `error_correction`, `validation_error.*`, `execution_status`, `duration`, `result_truncated` |
| `SemanticContextTool_<tool>` | Semantic view context retrieval | `semantic_context.semantic_model`, `tables`, `verified_queries`, `user_question`, `custom_instructions`, `duration`, `status` |
| `CortexSearchService_<tool>`, `CortexSearchSingleToolImpl` | Cortex Search call | `cortex_search.name` (FQN), `service_id`, `query`, `results`, `limit`, `columns`, `scoring_config`, `duration`, `status` |
| `CortexChartToolImpl-data_to_chart` | Chart generation | `chart_generation.{input_chart_spec,data_source,response.type,duration,status}` |
| `CodeExecutionTool_<cmd>` (bash, write, edit, grep, skill, task, snowflake_sql_execute, plan_mode) | Sandbox / code execution | `code_execution.{name,argument.*,duration,status}` |
| `ServerSkillTool_<skill>`, `ToolCall-<name>` | Skills / custom tools (UDF/procedure) | tool id, args, status |
| `UserMemoryInjection`, `SummarizeMemory*` | Memory | `memory.injection.count/state` |
| `LLM Suggested Queries` | Follow-up suggestions | model, token counts |
| `scheduled_agent_run` | Scheduled/task-triggered runs | `task.uuid`, `orchestrator_http_status` |
| `CORTEX_AGENT_FEEDBACK` | **User feedback** (thumbs + text) | per docs: agent, user, feedback text, positive/negative. **0 rows in this account today** — schema must be confirmed when first feedback lands. |

Access: recommended path is `SNOWFLAKE.LOCAL.GET_AI_OBSERVABILITY_EVENTS(db, schema, agent, 'CORTEX AGENT')` (needs `MONITOR` on agent + `SNOWFLAKE.CORTEX_USER`). Account-wide direct `SELECT` requires `SNOWFLAKE.AI_OBSERVABILITY_READER`. Full text (questions, responses, tool I/O, feedback text) requires account privilege **`READ UNREDACTED AI OBSERVABILITY EVENTS TABLE`**; without it only metadata is visible.

> Per docs: event-table token counts are best-effort and may undercount. **Usage views are the source of truth for cost**; the event table explains *what happened*.

### 4.3 Agent configuration & inventory
| Source | Use |
|---|---|
| `SHOW AGENTS IN ACCOUNT` | Inventory: name, db, schema, owner, comment, `profile` (display name, avatar, color), created_on |
| `DESCRIBE AGENT <fqn>` → `agent_spec` (JSON), `versions`, `aliases`, `default_version_name` | Models (`models.orchestration`), `orchestration.budget.{seconds,tokens}`, `orchestration.capabilities` (e.g. `analytical_search`), `instructions.{system,orchestration,response,sample_questions}`, `tools[].tool_spec.{type,name,description}`, `tool_resources` (semantic view / search service / warehouse bindings per tool) |
| `ACCOUNT_USAGE.TAG_REFERENCES` (`DOMAIN='USER'` / agent) | Team / cost-center attribution |
| `ACCOUNT_USAGE.USERS` | User attributes (email, display name, type, default role, disabled) |
| `ACCOUNT_USAGE.QUERY_HISTORY` | Warehouse runtime / bytes for agent-generated SQL via `query_id` (limit windows to ≤7 days per query) |
| `SHOW SEMANTIC VIEWS` / `DESCRIBE SEMANTIC VIEW`, `SHOW CORTEX SEARCH SERVICES` | Asset metadata (owner, verified-query count, last altered) |
| `SNOWFLAKE.LOCAL.CORTEX_ANALYST_REQUESTS_V` | Direct (non-agent) Analyst usage of the same semantic views — optional comparison |

Tool types seen in specs: `cortex_analyst_text_to_sql`, `cortex_search`, `generic` (custom UDF/procedure), `data_to_chart`, web search, code execution/sandbox, MCP connectors, server skills. Config flags such as **web search enabled** and **sandbox/code execution enabled** are derived from the presence of those tool types/capabilities in `agent_spec` — exact key names to be confirmed per spec variant (§11).

## 5. Data Architecture

### 5.1 Pattern
SAR app reads **only from a curated mart** (`AGENT_OBS` database) — never from raw sources at request time. Ingestion runs as Snowflake Tasks/Dynamic Tables under a dedicated service role.

```
ACCOUNT_USAGE views ─┐
AI_OBSERVABILITY_EVENTS ─┼─► RAW (incremental copies) ─► CORE (facts/dims) ─► MART (aggregates, themes) ─► SAR app
SHOW/DESCRIBE AGENTS (proc) ─┘                                  ▲
                                         AI enrichment (AI_EMBED/AI_CLASSIFY/AI_COMPLETE)
```

### 5.2 Ingestion requirements
- R-ING-1 Incremental load of both usage views on `START_TIME` with a **3-hour lookback** to absorb latency; MERGE on `REQUEST_ID`.
- R-ING-2 Incremental load of `AI_OBSERVABILITY_EVENTS` on `TIMESTAMP` (lookback 2 h), filtered to `RESOURCE/RECORD object.type = 'Cortex Agent'` and excluding CoCo spans (`CodingAgent*`). Event rows are immutable → append + dedupe on (`TRACE:trace_id`, `TRACE:span_id`, `RECORD:name`, timestamp).
- R-ING-3 Agent config snapshot procedure runs **hourly**: `SHOW AGENTS IN ACCOUNT` + `DESCRIBE AGENT` for each; store full `agent_spec` JSON with a hash; insert new row only when hash changes → **SCD2 config history**.
- R-ING-4 Daily snapshot of semantic views and Cortex Search services (inventory + verified query counts).
- R-ING-5 Retention: keep raw ≥ 13 months (exceeds ACCOUNT_USAGE 1-yr window so YoY works).
- R-ING-6 Freshness monitoring: each table exposes `last_loaded_at`; app shows a freshness banner (usage ≈ 1 h lag, events ≈ minutes).

### 5.3 Core model (minimum)

| Table | Grain | Notes |
|---|---|---|
| `DIM_AGENT` | agent (SCD2 by spec hash) | FQN, display name, owner, comment, models, budget, capability flags (web_search, code_execution/sandbox, analytical_search, memory, MCP), tool count by type, instructions length, sample questions, default version, aliases |
| `DIM_AGENT_TOOL` | agent version × tool | tool name, type, description, bound resource FQN (semantic view / search service / function), warehouse |
| `DIM_ASSET` | semantic view / search service / function | FQN, type, owner, verified query count, last altered |
| `DIM_USER` | user | name, email, type, default role, tags (cost center, team) |
| `FACT_TURN` | 1 row / turn | `request_id`, `thread_id`, `message_id`, `parent_message_id`, `trace_id`, turn #, source (`COWORK_UI` / interface), cowork instance, agent FQN, version, user, role, session, trigger_type, start/end, duration_ms (usage) and agent.duration (trace), status/code, research_mode, question, response, thinking, suggested queries, tokens (in/out/cache r/w/total), `TOKEN_CREDITS`, `ai_functions_credits`, `sql_query_credits`, combined credits, warehouses, inference region, #planning steps, #tool calls, #SQL errors, verified_query_used flag, feedback (sentiment, text), theme_id |
| `FACT_TURN_MODEL_USAGE` | turn × step × service_type × model | from flattened granular arrays (authoritative) |
| `FACT_SPAN` | 1 row / span | trace_id, span_id, parent_span_id, span name, span category (planning / response / analyst / sql / search / chart / code_exec / skill / custom / memory / suggestions / other), tool name, resource FQN, model, start/end/duration, status, tokens, input/output payload (VARIANT, unredacted only) |
| `FACT_SQL_EXECUTION` | SQL span | semantic model, tool, final SQL, query_id, verified_query_used, error_correction, validation errors, status, duration, + QUERY_HISTORY metrics |
| `FACT_SEARCH_CALL` | search span | service FQN, query, limit, result count, duration, status |
| `FACT_FEEDBACK` | feedback event | turn/thread link, user, positive/negative, text, timestamp |
| `FACT_THREAD` | thread | first message, #turns, duration, users, agents/versions involved, total credits, last updated, max-severity status, feedback rollup |

### 5.4 Key joins
- Turn cost ↔ trace: `usage.REQUEST_ID = AgentV2RequestResponseInfo.snow.ai.observability.agent.request_id` (verified on thread `280322576125`: 3/3 turns matched).
- Thread: `snow.ai.observability.agent.thread_id` (not present in usage views — **only** obtainable from events).
- Turn ↔ spans: `TRACE:trace_id`; span tree via `RECORD:parent_span_id`.
- SQL ↔ warehouse cost: `sql_execution.query_id = QUERY_HISTORY.QUERY_ID`.
- Agent version: `object.version.name` on spans ↔ `METADATA:agent_version_name` ↔ `DIM_AGENT` SCD2.

## 6. AI Enrichment (Question Intelligence)

- R-AI-1 **Embeddings**: `AI_EMBED` on each user question (and first message of thread) → stored vector.
- R-AI-2 **Theme discovery**: periodic clustering (e.g. weekly, Snowpark/ML job over embeddings) → `DIM_THEME` with an LLM-generated label + description (`AI_COMPLETE` over cluster samples). Themes are **global** (cross-agent) so the same theme can be compared across agents.
- R-AI-3 **Assignment**: new questions assigned to nearest theme daily; below similarity threshold → "Emerging / Unclustered".
- R-AI-4 **Classification** (`AI_CLASSIFY`) per turn: intent (lookup, trend, comparison, root cause, how-to, action/write, chit-chat), business domain, and **answer outcome** heuristics (answered / clarification asked / refused / error / "no data").
- R-AI-5 **Signals per theme** (time-windowed): volume, WoW growth, unique users, agents serving it, avg turns/thread, failure rate, SQL error rate, verified-query hit rate, negative-feedback rate, avg credits, p50/p95 latency, re-ask rate (same user, similar question within 24 h → dissatisfaction proxy).
- R-AI-6 **Gap detection**: themes with high volume + low verified-query coverage / high error / negative feedback → "Recommended verified queries" list (question exemplars + SQL generated) exportable for the semantic view owner.
- R-AI-7 Optional `AI_SENTIMENT` on follow-up messages ("that's wrong", "no, I meant…") as an implicit-feedback signal.
- R-AI-8 Enrichment cost is tracked and shown in an "App cost" admin panel; enrichment runs only on new turns.

## 7. Functional Requirements — App Screens

Global controls on every screen: **time range** (default last 30 d), agent(s), interface/source, CoWork instance, user / user tag (team), role, model, version, theme. All filters are URL-encoded (shareable deep links). Every chart supports drill-down to the next altitude.

### 7.1 Portfolio Overview (strategic)
- KPI tiles: turns, threads, active users (DAU/WAU/MAU), credits (combined), tokens, p50/p95 latency, success rate, positive-feedback %, with period-over-period deltas.
- Trend: daily turns & credits, stacked by agent or interface.
- Agent leaderboard: turns, users, credits, credits/turn, success %, feedback %, p95 latency, last used, sparkline; flags: **idle** (no use in 30 d), **cost outlier**, **quality regression**.
- Interface mix (CoWork UI / API / SQL / Teams / MCP / scheduled).
- Top themes (cross-agent) with growth arrows.
- Model mix and cost by model/service type.
- Adoption funnel: provisioned agents → used → used by ≥5 users → used weekly.

### 7.2 Agent Detail (operational)
- Header: display name, FQN, owner, description, default version, aliases, created, **config badges** (models, budget seconds/tokens, web search, code execution/sandbox, memory, analytical_search, # tools by type).
- Usage, cost, latency, quality trends; version markers on charts (config change annotations from SCD2).
- Top users, top themes, top questions (verbatim, deduped), failed/negative turns list.
- Tool usage: calls per tool, success %, avg/p95 duration, share of turns; tool-selection mix from planning spans.
- Planning depth distribution (# planning steps / turn), budget-exhausted turns.
- **Version comparison**: pick two versions → side-by-side metrics + spec diff (instructions, tools, models).

### 7.3 Themes Explorer (question intelligence)
- Theme table with all R-AI-5 signals; sort by volume, growth, pain (failure × volume), cost.
- Theme × Agent heatmap (which agents answer which themes, and how well).
- Theme detail: definition, exemplar questions, trend, agents, users, tools/assets used, failure examples, recommended verified queries.
- Emerging themes and unclustered questions queue.
- Search: free-text/semantic search across all questions.

### 7.4 Semantic Views & Search Services (asset intelligence)
- Asset catalog: each semantic view / search service / custom tool function with: # agents bound (from config), # agents actually using (from spans), calls, distinct users, themes served, success %, SQL error %, verified-query hit %, p95 duration, credits attributed.
- **Shared-asset view**: assets used by ≥2 agents, with per-agent breakdown (same SV, different instructions → different outcomes).
- Semantic view detail: tables touched (`semantic_context.tables`), verified queries used (hit counts) vs. defined, top questions, generated SQL samples, validation/execution errors grouped by message, linked `QUERY_HISTORY` cost.
- Search service detail: query samples, result counts, empty-result rate, latency.
- Orphans: assets bound but never used; agents referencing dropped assets.

### 7.5 Users & Feedback
- User table: turns, threads, agents used, credits, last active, feedback given, positive %, team tags.
- Cohorts / retention: new vs returning users per week, by agent.
- Feedback feed: thumbs up/down + text, linked to turn trace; filter negative only; group by theme/agent.
- Implicit dissatisfaction signals (re-asks, "that's wrong" follow-ups).

### 7.6 Cost & Performance
- Credits by agent / user / team tag / model / service type / interface / warehouse; token-credit vs AI-functions vs SQL credits.
- Cache efficiency: cache-read share of input tokens per agent/model.
- Latency: distribution and p50/p95/p99 by agent, tool, model; slowest turns; time decomposition per turn (planning vs tools vs SQL vs response generation).
- Most expensive turns/threads (drill to trace).
- Forecast: month-end credits at current run rate.

### 7.7 Thread & Trace Explorer (forensic — parity with Snowsight)
- Thread list: first message, agent, user, # turns, versions involved (multi-version icon), last updated, total credits, feedback, status. Search by thread id, request id, user, text.
- Thread view: chat transcript (user/assistant), per-turn badges (credits, tokens, latency, version, feedback).
- **Turn trace view**: span tree/waterfall (Gantt) from `parent_span_id` with timing; click a span for full attributes:
  - Planning: model, step #, tool selected + arguments, thinking, tokens.
  - Analyst/SQL: semantic view, generated SQL (formatted), verified query used, error correction, validation errors, result preview, `query_id` link to Snowsight query profile.
  - Search: service, query, results.
  - Chart: spec + rendered preview.
  - Code execution / skills / custom tools: arguments, status.
  - Response: final text (markdown rendered), suggested follow-ups.
- Raw JSON toggle on every span; copy link; export thread (JSON / markdown).
- Authoritative cost panel for the turn from usage views (granular service × model breakdown), with a note when event-table tokens differ.

### 7.8 Agent Configuration Catalog
- Table of all agents with every config attribute as filterable columns: models, budget, web search, code execution/sandbox, memory, MCP connectors, # Analyst / Search / custom tools, bound semantic views & search services, owner, comment, versions, last spec change.
- Config change log (SCD2 diffs) across agents.
- Governance flags: web search enabled, code execution enabled, owner = ACCOUNTADMIN, no description, no sample questions, unbounded budget, agents with no `MONITOR` grant to the app role (coverage gap).

### 7.9 Admin
- Pipeline freshness and row counts; failed task runs.
- Coverage: agents visible to app role vs total agents.
- Enrichment config (theme count, similarity threshold, schedule) and app's own credit spend.

## 8. Metric Definitions (canonical)

| Metric | Definition |
|---|---|
| Turn | One row in either usage view (one `agent:run`) |
| Thread | Distinct `thread_id` from events; fallback `COALESCE(PARENT_REQUEST_ID, REQUEST_ID)` when no events |
| Active user | Distinct `USER_ID` with ≥1 turn in window |
| Combined credits | `TOKEN_CREDITS + COALESCE(ai_functions_credits,0) + COALESCE(sql_query_credits,0)` |
| Latency (turn) | `END_TIME − START_TIME` (ms) from usage; trace `agent.duration` as secondary |
| Success rate | Turns with `agent.status.code` OK and no unrecovered tool error / total turns |
| SQL error rate | SQL spans with non-success status or validation error / SQL spans |
| Verified-query hit rate | SQL spans with `verified_query_used` true / SQL spans |
| Feedback % positive | Positive `CORTEX_AGENT_FEEDBACK` / all feedback |
| Feedback coverage | Turns with feedback / turns |
| Cache share | `cache_read_input / (input + cache_read_input + cache_write_input)` |
| Re-ask rate | Turns whose question is ≥0.9 cosine-similar to the same user's question < 24 h earlier |

All credits reported as **AI credits**, not currency (optional rate setting for $).

## 9. Non-Functional Requirements

- **Platform**: SAR application service (Next.js or Streamlit-on-SAR — decide at design; Next.js recommended for trace waterfall/drill UX). Deployed via `snow` CLI with `snowflake.yml`/`app.yml`.
- **Security**:
  - App runs as a dedicated service role `AGENT_OBS_APP_ROLE` with read only on the `AGENT_OBS` mart.
  - Ingestion role `AGENT_OBS_INGEST_ROLE`: `SNOWFLAKE.USAGE_VIEWER`, `SNOWFLAKE.GOVERNANCE_VIEWER`, `SNOWFLAKE.SECURITY_VIEWER`, `SNOWFLAKE.AI_OBSERVABILITY_READER` (account-wide), `MONITOR` on all agents (+ `FUTURE` grants per schema), `SNOWFLAKE.CORTEX_USER`, and `READ UNREDACTED AI OBSERVABILITY EVENTS TABLE` **only if** content analytics are approved.
  - Two content tiers: **metadata-only** (default for all app users) and **content** (questions, responses, SQL, feedback text) gated by an app role mapped from Snowflake roles; enforce via row access / masking policies on the mart, not only in UI.
  - Optional row-level restriction: agent owners see only their agents (row access policy on agent FQN ↔ role).
  - PII: questions may contain PII; apply `AI_REDACT` option before embedding/theme labels if required.
- **Performance**: Portfolio screens < 2 s p95 from pre-aggregated mart; trace view < 3 s for 200-span traces; support ≥ 1M turns / 50M spans.
- **Freshness**: events ≤ 15 min; usage/cost ≤ 2 h; config ≤ 1 h; themes daily.
- **Cost**: Ingestion + enrichment budget target < 5 % of observed agent credits; app on serverless/XS compute.
- **Auditability**: app logs who viewed content-tier records (user, thread id, time) to an audit table.
- **Extensibility**: org-level (multi-account) via `ORGANIZATION_USAGE` usage views in v2; CoCo tab optional.

## 10. Phasing

| Phase | Scope |
|---|---|
| **v0.1 (MVP)** | Ingestion of usage + events + config; FACT_TURN/SPAN/THREAD; Portfolio, Agent Detail, Thread & Trace Explorer, Config Catalog; metadata vs content tiers |
| **v0.2** | Themes (embeddings, clustering, signals), Themes Explorer, Semantic View & Search asset pages, shared-asset analysis |
| **v0.3** | Feedback & implicit signals, users/cohorts, version comparison + spec diffs, recommended verified queries export |
| **v1.0** | Cost forecasting, alerts (theme spike, error-rate regression, cost anomaly → email/Slack via notification integration), org-wide view, audit log UI |

## 11. Open Questions & Risks

1. **Feedback schema unverified** — `CORTEX_AGENT_FEEDBACK` has 0 rows in this account. Generate test feedback (thumbs up/down with text in CoWork) and confirm attributes + link key to turn (`message_id` / `request_id`).
2. **Config flag key names** — web search, code execution/sandbox, MCP, memory: confirm exact `agent_spec` keys/tool types across agents (sample `DESCRIBE AGENT` for all 33 and catalog distinct `tool_spec.type` and `orchestration.*` keys).
3. **Attribute churn** — event attributes are semi-structured and evolve (e.g. `AgentV2…` vs `AgentPassthrough…`, numbered span names). Parse with a mapping table (span-name regex → category) rather than hard-coding; alert on unseen span names.
4. **Event-table completeness** — best-effort delivery; never derive billed cost from spans.
5. **Redaction** — without `READ UNREDACTED…`, themes/questions are unavailable; decide governance stance early.
6. **Native App agents** — provider details are redacted for app-created agents; show as limited.
7. **Version labeling** — live/draft turns relabel after commit (per docs); store raw recorded version and resolve at read time.
8. **Thread fallback** — turns in usage views with no matching event (dropped spans, retention) still need a thread; use `PARENT_REQUEST_ID` fallback and flag.
9. **SAR framework choice** — Next.js vs Streamlit-on-SAR; trace waterfall & heavy drill-down favor Next.js.
10. **Theme stability** — re-clustering changes IDs; need theme lineage (merge/split mapping) to keep trends continuous.

## 12. Acceptance Criteria (MVP samples)

- A1. For thread `280322576125` the app shows 3 turns with questions "What is revenue by product category?", "How does category revenue break down by region?", "do you have any reports pre-built that i can run to see this?", credits 0.1633 / 0.1289 / 0.0546 and tokens 86,398 / 232,228 / 201,116, matching `SNOWFLAKE_COWORK_USAGE_HISTORY`.
- A2. Sum of combined credits on Portfolio for any window equals the sum from both usage views (± 0.0001).
- A3. Turn trace view renders every span present in `AI_OBSERVABILITY_EVENTS` for that `trace_id`, in correct parent/child order, with timings.
- A4. Config Catalog lists all agents returned by `SHOW AGENTS IN ACCOUNT` (33 today) with tool counts by type matching `DESCRIBE AGENT`.
- A5. A user without the content-tier role sees no question/response/SQL text anywhere (verified by policy, not UI only).

## Appendix A — Reference SQL

### A.1 Turn-level usage with full granular breakdown
```sql
WITH base AS (
  SELECT 'COWORK_UI' src, 'cowork_ui' iface, SNOWFLAKE_COWORK_NAME cowork_name, *
         EXCLUDE (SNOWFLAKE_COWORK_ID, SNOWFLAKE_COWORK_NAME)
  FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY
  WHERE START_TIME >= :since
  UNION ALL BY NAME
  SELECT 'AGENT_API', COALESCE(METADATA:interaction_interface::STRING,'unknown'), NULL, *
  FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_USAGE_HISTORY
  WHERE START_TIME >= :since
)
SELECT b.REQUEST_ID, t3.key service_type, COALESCE(NULLIF(t4.key,''),'unknown') model,
       t2.value:start_time::TIMESTAMP_TZ step_start,
       t4.value:input::NUMBER input_tokens, t4.value:output::NUMBER output_tokens,
       t4.value:cache_read_input::NUMBER cache_read, t4.value:cache_write_input::NUMBER cache_write,
       c4.value:input::FLOAT + c4.value:output::FLOAT
         + COALESCE(c4.value:cache_read_input::FLOAT,0) + COALESCE(c4.value:cache_write_input::FLOAT,0) credits
FROM base b,
  LATERAL FLATTEN(b.TOKENS_GRANULAR) t1, LATERAL FLATTEN(t1.value) t2,
  LATERAL FLATTEN(t2.value) t3, LATERAL FLATTEN(t3.value) t4,
  LATERAL FLATTEN(b.CREDITS_GRANULAR) c1, LATERAL FLATTEN(c1.value) c2,
  LATERAL FLATTEN(c2.value) c3, LATERAL FLATTEN(c3.value) c4
WHERE t2.key <> 'start_time' AND t3.key <> 'start_time'
  AND c1.index = t1.index AND c2.key = t2.key AND c3.key = t3.key AND c4.key = t4.key;
```

### A.2 Turn content joined to authoritative cost
```sql
WITH obs AS (
  SELECT
    RECORD_ATTRIBUTES:"snow.ai.observability.agent.thread_id"::STRING        thread_id,
    RECORD_ATTRIBUTES:"snow.ai.observability.agent.request_id"::STRING       request_id,
    RECORD_ATTRIBUTES:"snow.ai.observability.agent.parent_message_id"::STRING parent_message_id,
    RECORD_ATTRIBUTES:"snow.ai.observability.object.name"::STRING            agent_name,
    RECORD_ATTRIBUTES:"snow.ai.observability.object.version.name"::STRING    agent_version,
    RECORD_ATTRIBUTES:"ai.observability.record_root.input"::STRING           question,
    RECORD_ATTRIBUTES:"snow.ai.observability.agent.response"::STRING         response,
    RECORD_ATTRIBUTES:"snow.ai.observability.agent.status.code"::STRING      status_code,
    RECORD_ATTRIBUTES:"snow.ai.observability.agent.duration"::NUMBER         agent_duration_ms,
    TRACE:trace_id::STRING                                                   trace_id
  FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS
  WHERE RECORD:name::STRING = 'AgentV2RequestResponseInfo'
    AND TIMESTAMP >= :since
)
SELECT o.*, u.START_TIME, u.USER_NAME, u.TOKENS, u.TOKEN_CREDITS,
       COALESCE(u.METADATA:sql_query_credits::FLOAT,0) sql_query_credits
FROM obs o
LEFT JOIN (
  SELECT REQUEST_ID::STRING rid, START_TIME, USER_NAME, TOKENS, TOKEN_CREDITS, METADATA
  FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY WHERE START_TIME >= :since
  UNION ALL
  SELECT REQUEST_ID::STRING, START_TIME, USER_NAME, TOKENS, TOKEN_CREDITS, METADATA
  FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_USAGE_HISTORY WHERE START_TIME >= :since
) u ON u.rid = o.request_id;
```

### A.3 Semantic view / search usage across agents
```sql
SELECT
  COALESCE(RECORD_ATTRIBUTES:"snow.ai.observability.agent.tool.cortex_analyst.semantic_model",
           RECORD_ATTRIBUTES:"snow.ai.observability.agent.tool.semantic_context.semantic_model",
           RECORD_ATTRIBUTES:"snow.ai.observability.agent.tool.cortex_search.name")::STRING asset,
  CASE WHEN RECORD:name::STRING ILIKE 'CortexSearch%' THEN 'CORTEX_SEARCH' ELSE 'SEMANTIC_VIEW' END asset_type,
  COUNT(DISTINCT RECORD_ATTRIBUTES:"snow.ai.observability.object.name") agents_using,
  ARRAY_AGG(DISTINCT RECORD_ATTRIBUTES:"snow.ai.observability.object.name") agents,
  COUNT(*) calls
FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS
WHERE TIMESTAMP >= :since
  AND (RECORD:name::STRING ILIKE 'SystemExecuteSQLTool%'
    OR RECORD:name::STRING ILIKE 'SemanticContextTool_%'
    OR RECORD:name::STRING ILIKE 'CortexSearchService_%')
GROUP BY 1,2
ORDER BY agents_using DESC, calls DESC;
```

### A.4 Feedback (per docs)
```sql
SELECT * FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_OBSERVABILITY_EVENTS(:db, :schema, :agent, 'CORTEX AGENT'))
WHERE RECORD:name = 'CORTEX_AGENT_FEEDBACK';
```

## Appendix B — Documentation references
- Monitor Cortex Agent requests — https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-monitor
- GET_AI_OBSERVABILITY_EVENTS — https://docs.snowflake.com/en/sql-reference/functions/get_ai_observability_events-snowflake-local
- AI_OBSERVABILITY_EVENTS table — https://docs.snowflake.com/en/sql-reference/local/ai_observability_events
- READ UNREDACTED AI OBSERVABILITY EVENTS TABLE — https://docs.snowflake.com/en/release-notes/bcr-bundles/un-bundled/bcr-read-unredacted-ai-observability-events
- Cortex Agent evaluations — https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-evaluations
- Turn agent feedback into evaluation datasets — https://docs.snowflake.com/en/developer-guide/cortex-ai-cookbook/agent-feedback-to-evals
