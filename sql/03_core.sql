-- =====================================================================
-- 03_core.sql  —  conformed facts & dims (dynamic tables over RAW)
-- All *_UTC columns are TIMESTAMP_NTZ in UTC (event table is UTC NTZ;
-- usage LTZ is converted). Content columns are masked in 05_policies.sql.
-- =====================================================================
USE ROLE AGENT_OBS_INGEST_ROLE;
USE WAREHOUSE AGENT_OBS_WH;
USE SCHEMA AGENT_OBS.CORE;

-- ---------------------------------------------------------------------
-- Span categorization (IMMUTABLE so DTs stay incremental). Add new span
-- families here; ADMIN.V_UNMAPPED_SPANS lists names falling to 'other'.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION AGENT_OBS.ADMIN.SPAN_CATEGORY(NAME STRING) RETURNS STRING IMMUTABLE AS
$$
  CASE
    WHEN NAME IN ('AgentV2RequestResponseInfo','AgentPassthroughRequestResponseInfo') THEN 'turn_info'
    WHEN NAME = 'Agent'                                     THEN 'root'
    WHEN NAME LIKE 'ReasoningAgentStepPlanning-%'           THEN 'planning'
    WHEN NAME LIKE 'ReasoningAgentStepResponseGeneration-%' THEN 'response'
    WHEN STARTSWITH(NAME, 'SystemExecuteSQLTool_')          THEN 'sql'
    WHEN STARTSWITH(NAME, 'SqlExecution')                   THEN 'sql_exec'   -- child span; repeats parent's SQL attributes
    WHEN STARTSWITH(NAME, 'CortexAnalystTool_')             THEN 'analyst'
    WHEN STARTSWITH(NAME, 'SemanticContextTool_')           THEN 'semantic_context'
    WHEN STARTSWITH(NAME, 'CortexSearch')                   THEN 'search'
    WHEN STARTSWITH(NAME, 'CortexChartTool')                THEN 'chart'
    WHEN STARTSWITH(NAME, 'CodeExecutionTool_')             THEN 'code_exec'
    WHEN STARTSWITH(NAME, 'ServerSkillTool_')               THEN 'skill'
    WHEN STARTSWITH(NAME, 'TaskTool_')                      THEN 'subagent'
    WHEN STARTSWITH(NAME, 'AgentTaskTool_')                 THEN 'agent_task'
    WHEN NAME = 'Guardrails'                                THEN 'guardrails'
    WHEN NAME ILIKE '%websearch%' OR NAME ILIKE '%web_search%' THEN 'web_search'
    WHEN NAME ILIKE '%mcp%'                                 THEN 'mcp'
    WHEN NAME LIKE 'ToolCall-%'                             THEN 'custom'
    WHEN NAME = 'UserMemoryInjection' OR NAME LIKE 'SummarizeMemory%' THEN 'memory'
    WHEN NAME = 'LLM Suggested Queries'                     THEN 'suggestions'
    WHEN NAME = 'scheduled_agent_run'                       THEN 'scheduled'
    ELSE 'other'
  END
$$;

CREATE OR REPLACE FUNCTION AGENT_OBS.ADMIN.SPAN_TOOL_FROM_NAME(NAME STRING) RETURNS STRING IMMUTABLE AS
$$ NULLIF(REGEXP_SUBSTR(NAME,
     '^(SystemExecuteSQLTool_|CortexAnalystTool_|SemanticContextTool_|CortexSearchService_|CodeExecutionTool_|ServerSkillTool_|AgentTaskTool_|TaskTool_|ToolCall-)(.+)$',
     1, 1, 'e', 2), '') $$;

-- ---------------------------------------------------------------------
-- AGENT_TRACE: trace ids that belong to Cortex Agent turns
-- (evaluation runs carry run.id and are excluded; CoCo has no object.type)
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE CORE.AGENT_TRACE
  TARGET_LAG = DOWNSTREAM WAREHOUSE = AGENT_OBS_WH REFRESH_MODE = INCREMENTAL
AS
SELECT DISTINCT TRACE_ID
FROM AGENT_OBS.RAW.AI_OBS_EVENTS
WHERE TRACE_ID IS NOT NULL
  AND (RECORD_NAME IN ('AgentV2RequestResponseInfo','AgentPassthroughRequestResponseInfo')
       OR (RECORD_ATTRIBUTES:"snow.ai.observability.object.type"::STRING ILIKE 'cortex agent'
           AND RECORD_ATTRIBUTES:"snow.ai.observability.run.id" IS NULL));

-- ---------------------------------------------------------------------
-- EVENT_AGENT: Cortex Agent events only (excludes CoCo, evals, logs),
-- with common identifiers extracted. Spans with no agent attributes
-- (e.g. passthrough turns) are kept when their trace is an agent turn.
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE CORE.EVENT_AGENT
  TARGET_LAG = DOWNSTREAM WAREHOUSE = AGENT_OBS_WH REFRESH_MODE = INCREMENTAL
  COMMENT = 'Cortex Agent events (spans, request & feedback events) from RAW.AI_OBS_EVENTS'
AS
WITH ev AS (
  SELECT e.* FROM AGENT_OBS.RAW.AI_OBS_EVENTS e JOIN CORE.AGENT_TRACE t ON t.TRACE_ID = e.TRACE_ID
  UNION ALL
  SELECT e.* FROM AGENT_OBS.RAW.AI_OBS_EVENTS e
  WHERE e.TRACE_ID IS NULL
    AND e.RECORD_NAME IN ('CORTEX_AGENT_REQUEST','CORTEX_AGENT_FEEDBACK')
    AND e.RECORD_ATTRIBUTES:"snow.ai.observability.object.type"::STRING ILIKE 'cortex agent'
)
SELECT
  e.EVENT_HASH,
  e.TIMESTAMP                                   AS END_TS_UTC,
  COALESCE(e.START_TIMESTAMP, e.TIMESTAMP)      AS START_TS_UTC,
  e.RECORD_TYPE,
  e.RECORD_NAME,
  e.TRACE_ID,
  e.TRACE:span_id::STRING                       AS SPAN_ID,
  e.RECORD:parent_span_id::STRING               AS PARENT_SPAN_ID,
  e.RECORD:kind::STRING                         AS SPAN_KIND,
  e.RECORD:status:code::STRING                  AS SPAN_STATUS_CODE,
  e.RECORD:status:message::STRING               AS SPAN_STATUS_MESSAGE,
  e.RECORD_ATTRIBUTES:"snow.ai.observability.agent.thread_id"::STRING       AS THREAD_ID,
  e.RECORD_ATTRIBUTES:"snow.ai.observability.agent.message_id"::STRING      AS MESSAGE_ID,
  e.RECORD_ATTRIBUTES:"snow.ai.observability.agent.parent_message_id"::STRING AS PARENT_MESSAGE_ID,
  COALESCE(e.RECORD_ATTRIBUTES:"snow.ai.observability.agent.request_id",
           e.RECORD_ATTRIBUTES:"request_id")::STRING                        AS REQUEST_ID,
  e.RECORD_ATTRIBUTES:"ai.observability.record_id"::STRING                  AS RECORD_ID,
  e.RECORD_ATTRIBUTES:"snow.ai.observability.database.name"::STRING        AS AGENT_DATABASE_NAME,
  e.RECORD_ATTRIBUTES:"snow.ai.observability.schema.name"::STRING          AS AGENT_SCHEMA_NAME,
  e.RECORD_ATTRIBUTES:"snow.ai.observability.object.name"::STRING          AS AGENT_NAME,
  e.RECORD_ATTRIBUTES:"snow.ai.observability.object.id"::NUMBER            AS AGENT_ID,
  e.RECORD_ATTRIBUTES:"snow.ai.observability.object.version.name"::STRING  AS AGENT_VERSION_NAME,
  e.RECORD_ATTRIBUTES:"snow.ai.observability.object.version.id"::STRING    AS AGENT_VERSION_ID,
  COALESCE(e.RECORD_ATTRIBUTES:"snow.ai.observability.user.name", e.RESOURCE_ATTRIBUTES:"snow.user.name")::STRING AS USER_NAME,
  COALESCE(e.RECORD_ATTRIBUTES:"snow.ai.observability.user.id",   e.RESOURCE_ATTRIBUTES:"snow.user.id")::NUMBER   AS USER_ID,
  COALESCE(e.RECORD_ATTRIBUTES:"snow.ai.observability.role.name",
           e.RESOURCE_ATTRIBUTES:"snow.session.role.primary.name")::STRING  AS ROLE_NAME,
  COALESCE(e.RECORD_ATTRIBUTES:"snow.ai.observability.session.id", e.RESOURCE_ATTRIBUTES:"snow.session.id")::STRING AS SESSION_ID,
  e.RECORD_ATTRIBUTES                           AS ATTRS,          -- content (masked)
  e.VALUE                                       AS EVENT_VALUE     -- content (masked)
FROM ev e;

-- ---------------------------------------------------------------------
-- FACT_SPAN: one row per span with category + metadata extracted
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE CORE.FACT_SPAN
  TARGET_LAG = DOWNSTREAM WAREHOUSE = AGENT_OBS_WH REFRESH_MODE = INCREMENTAL
  COMMENT = '1 row per agent span; ATTRS is the full attribute payload (content tier)'
AS
WITH s AS (
  SELECT e.*, AGENT_OBS.ADMIN.SPAN_CATEGORY(e.RECORD_NAME) AS SPAN_CATEGORY,
         COALESCE(e.ATTRS:"snow.ai.observability.agent.planning.status.code",
                  e.ATTRS:"snow.ai.observability.agent.tool.sql_execution.status.code",
                  e.ATTRS:"snow.ai.observability.agent.tool.cortex_search.status.code",
                  e.ATTRS:"snow.ai.observability.agent.status.code")::STRING AS TOOL_STATUS_CODE,
         -- planning tool_selection.* are JSON-array strings (parallel tool calls)
         ARRAY_TO_STRING(TRY_PARSE_JSON(e.ATTRS:"snow.ai.observability.agent.planning.tool_selection.name"::STRING), ',') AS TOOL_SELECTED_NAME,
         ARRAY_TO_STRING(TRY_PARSE_JSON(e.ATTRS:"snow.ai.observability.agent.planning.tool_selection.type"::STRING), ',') AS TOOL_SELECTED_TYPE
  FROM CORE.EVENT_AGENT e WHERE e.RECORD_TYPE = 'SPAN'
)
SELECT
  s.EVENT_HASH, s.TRACE_ID, s.SPAN_ID, s.PARENT_SPAN_ID, s.RECORD_NAME AS SPAN_NAME,
  REGEXP_REPLACE(s.RECORD_NAME, '-[0-9]+$', '-N') AS SPAN_NAME_NORM,
  s.SPAN_CATEGORY,
  COALESCE(
    s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.analyst_tool_name"::STRING,
    s.TOOL_SELECTED_NAME,
    AGENT_OBS.ADMIN.SPAN_TOOL_FROM_NAME(s.RECORD_NAME)) AS TOOL_NAME,
  COALESCE(s.ATTRS:"snow.ai.observability.agent.tool.cortex_analyst.semantic_model",
           s.ATTRS:"snow.ai.observability.agent.tool.semantic_context.semantic_model",
           s.ATTRS:"snow.ai.observability.agent.tool.cortex_search.name")::STRING AS RESOURCE_FQN,
  s.START_TS_UTC, s.END_TS_UTC,
  DATEDIFF(millisecond, s.START_TS_UTC, s.END_TS_UTC) AS DURATION_MS,
  s.SPAN_STATUS_CODE, s.TOOL_STATUS_CODE,
  (s.SPAN_STATUS_CODE = 'STATUS_CODE_ERROR' OR TRY_TO_NUMBER(s.TOOL_STATUS_CODE) >= 400) AS IS_ERROR,
  s.THREAD_ID, s.MESSAGE_ID, s.REQUEST_ID,
  s.AGENT_DATABASE_NAME, s.AGENT_SCHEMA_NAME, s.AGENT_NAME, s.AGENT_VERSION_NAME,
  s.ATTRS:"snow.ai.observability.agent.planning.model"::STRING           AS MODEL,
  s.ATTRS:"snow.ai.observability.agent.planning.step_number"::NUMBER     AS STEP_NUMBER,
  s.TOOL_SELECTED_NAME, s.TOOL_SELECTED_TYPE,
  s.ATTRS:"snow.ai.observability.agent.planning.token_count.input"::NUMBER            AS TOKENS_INPUT,
  s.ATTRS:"snow.ai.observability.agent.planning.token_count.output"::NUMBER           AS TOKENS_OUTPUT,
  s.ATTRS:"snow.ai.observability.agent.planning.token_count.cache_read_input"::NUMBER AS TOKENS_CACHE_READ,
  s.ATTRS:"snow.ai.observability.agent.planning.token_count.cache_write_input"::NUMBER AS TOKENS_CACHE_WRITE,
  s.ATTRS:"snow.ai.observability.agent.planning.token_count.total"::NUMBER            AS TOKENS_TOTAL,
  s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.query_id"::STRING          AS QUERY_ID,
  -- SQL outcome (only meaningful for SPAN_CATEGORY='sql'; avoids re-reading ATTRS downstream)
  (s.SPAN_CATEGORY = 'sql' AND (s.TOOL_STATUS_CODE <> '200'
     OR s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.execution_status"::STRING ILIKE 'SQL was NOT executed%')) AS IS_SQL_ERROR,
  COALESCE(s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.verified_query_used"::BOOLEAN, FALSE) AS VERIFIED_QUERY_USED,
  s.ATTRS                                                                 -- content (masked)
FROM s;

-- ---------------------------------------------------------------------
-- TURN_SPAN_STATS: per-trace rollup of spans (incremental aggregate)
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE CORE.TURN_SPAN_STATS
  TARGET_LAG = DOWNSTREAM WAREHOUSE = AGENT_OBS_WH REFRESH_MODE = INCREMENTAL
AS
SELECT TRACE_ID,
       COUNT_IF(SPAN_CATEGORY = 'planning')                                    AS PLANNING_STEPS,
       COUNT_IF(SPAN_CATEGORY IN ('sql','analyst','semantic_context','search','chart','code_exec',
                                  'skill','custom','web_search','mcp','subagent','agent_task'))        AS TOOL_CALLS,
       COUNT_IF(SPAN_CATEGORY = 'sql')                                         AS SQL_CALLS,
       COUNT_IF(IS_SQL_ERROR)                                                  AS SQL_ERRORS,
       COUNT_IF(SPAN_CATEGORY = 'sql' AND VERIFIED_QUERY_USED)                 AS VERIFIED_QUERY_HITS,
       COUNT_IF(SPAN_CATEGORY = 'search')                                      AS SEARCH_CALLS,
       COUNT_IF(SPAN_CATEGORY = 'web_search')                                  AS WEB_SEARCH_CALLS,
       COUNT_IF(SPAN_CATEGORY = 'code_exec')                                   AS CODE_EXEC_CALLS,
       COUNT_IF(IS_ERROR AND SPAN_CATEGORY NOT IN ('turn_info','root'))        AS ERROR_SPANS,
       COUNT(*)                                                                AS SPAN_COUNT,
       ARRAY_UNIQUE_AGG(TOOL_NAME)                                             AS TOOLS_USED,
       ARRAY_UNIQUE_AGG(MODEL)                                                 AS TRACE_MODELS,
       SUM(IFF(SPAN_CATEGORY = 'planning', DURATION_MS, 0))                    AS PLANNING_MS,
       SUM(IFF(SPAN_CATEGORY = 'response', DURATION_MS, 0))                    AS RESPONSE_MS,
       SUM(IFF(SPAN_CATEGORY IN ('sql','analyst','semantic_context','search','chart','code_exec',
                                'skill','custom','web_search','mcp','subagent','agent_task'), DURATION_MS, 0)) AS TOOL_MS,
       SUM(TOKENS_TOTAL)                                                       AS TRACE_TOKENS
FROM CORE.FACT_SPAN
GROUP BY TRACE_ID;

-- ---------------------------------------------------------------------
-- FACT_TURN_MODEL_USAGE: authoritative tokens/credits per turn × step ×
-- service type × model (4-level flatten of *_GRANULAR)
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE CORE.FACT_TURN_MODEL_USAGE
  TARGET_LAG = DOWNSTREAM WAREHOUSE = AGENT_OBS_WH REFRESH_MODE = INCREMENTAL
AS
WITH tok AS (
  SELECT u.REQUEST_ID, t1.index STEP_INDEX, t2.key SUB_REQUEST_ID,
         t2.value:start_time::STRING STEP_START, t3.key SERVICE_TYPE, t4.key MODEL, t4.value V
  FROM AGENT_OBS.RAW.USAGE_TURN u,
       LATERAL FLATTEN(u.TOKENS_GRANULAR) t1, LATERAL FLATTEN(t1.value) t2,
       LATERAL FLATTEN(t2.value) t3, LATERAL FLATTEN(t3.value) t4
  WHERE t3.key <> 'start_time' AND IS_OBJECT(t3.value)
), cred AS (
  SELECT u.REQUEST_ID, c1.index STEP_INDEX, c2.key SUB_REQUEST_ID, c3.key SERVICE_TYPE, c4.key MODEL, c4.value V
  FROM AGENT_OBS.RAW.USAGE_TURN u,
       LATERAL FLATTEN(u.CREDITS_GRANULAR) c1, LATERAL FLATTEN(c1.value) c2,
       LATERAL FLATTEN(c2.value) c3, LATERAL FLATTEN(c3.value) c4
  WHERE c3.key <> 'start_time' AND IS_OBJECT(c3.value)
)
SELECT t.REQUEST_ID, t.STEP_INDEX, t.SUB_REQUEST_ID,
       CONVERT_TIMEZONE('UTC', TRY_TO_TIMESTAMP_TZ(t.STEP_START, 'YYYY-MM-DD HH24:MI:SS.FF3 TZHTZM'))::TIMESTAMP_NTZ AS STEP_START_UTC,
       t.SERVICE_TYPE, COALESCE(NULLIF(t.MODEL, ''), 'unknown') AS MODEL,
       t.V:input::NUMBER AS TOKENS_INPUT, t.V:output::NUMBER AS TOKENS_OUTPUT,
       t.V:cache_read_input::NUMBER AS TOKENS_CACHE_READ, t.V:cache_write_input::NUMBER AS TOKENS_CACHE_WRITE,
       COALESCE(t.V:input::NUMBER,0) + COALESCE(t.V:output::NUMBER,0)
         + COALESCE(t.V:cache_read_input::NUMBER,0) + COALESCE(t.V:cache_write_input::NUMBER,0) AS TOKENS_TOTAL,
       c.V:input::FLOAT AS CREDITS_INPUT, c.V:output::FLOAT AS CREDITS_OUTPUT,
       c.V:cache_read_input::FLOAT AS CREDITS_CACHE_READ, c.V:cache_write_input::FLOAT AS CREDITS_CACHE_WRITE,
       COALESCE(c.V:input::FLOAT,0) + COALESCE(c.V:output::FLOAT,0)
         + COALESCE(c.V:cache_read_input::FLOAT,0) + COALESCE(c.V:cache_write_input::FLOAT,0) AS CREDITS_TOTAL
FROM tok t
LEFT JOIN cred c ON c.REQUEST_ID = t.REQUEST_ID AND c.STEP_INDEX = t.STEP_INDEX
                AND c.SUB_REQUEST_ID = t.SUB_REQUEST_ID AND c.SERVICE_TYPE = t.SERVICE_TYPE AND c.MODEL = t.MODEL;

-- ---------------------------------------------------------------------
-- FACT_TURN: 1 row per turn = usage (authoritative cost) ⟗ trace summary
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE CORE.FACT_TURN
  TARGET_LAG = DOWNSTREAM WAREHOUSE = AGENT_OBS_WH REFRESH_MODE = FULL
  COMMENT = '1 row per agent turn. Cost from usage views; content & behavior from trace.'
AS
WITH info AS (
  SELECT * FROM CORE.EVENT_AGENT
  WHERE RECORD_NAME IN ('AgentV2RequestResponseInfo','AgentPassthroughRequestResponseInfo')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY COALESCE(REQUEST_ID, TRACE_ID) ORDER BY END_TS_UTC DESC) = 1
), req AS (   -- turn header event: user/role/session/tokens; joins on record_id
  SELECT RECORD_ID, USER_ID, USER_NAME, ROLE_NAME, SESSION_ID, THREAD_ID,
         ATTRS:"snow.ai.observability.token_count.total"::NUMBER TRACE_TOKENS_TOTAL
  FROM CORE.EVENT_AGENT WHERE RECORD_NAME = 'CORTEX_AGENT_REQUEST' AND RECORD_ID IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY RECORD_ID ORDER BY END_TS_UTC DESC) = 1
), spans AS (
  SELECT * FROM CORE.TURN_SPAN_STATS
), mu AS (
  SELECT REQUEST_ID, SUM(TOKENS_INPUT) TI, SUM(TOKENS_OUTPUT) TO_, SUM(TOKENS_CACHE_READ) TCR,
         SUM(TOKENS_CACHE_WRITE) TCW, ARRAY_AGG(DISTINCT MODEL) MODELS
  FROM CORE.FACT_TURN_MODEL_USAGE GROUP BY REQUEST_ID
), j AS (
  SELECT
    COALESCE(u.REQUEST_ID, i.REQUEST_ID, i.TRACE_ID) AS TURN_ID,
    COALESCE(u.REQUEST_ID, i.REQUEST_ID)              AS REQUEST_ID,
    i.TRACE_ID,
    -- thread_id 0 = API call without a thread: treat as absent so turns aren't lumped together.
    COALESCE(NULLIF(i.THREAD_ID, '0'), NULLIF(r.THREAD_ID, '0'), NULLIF(u.THREAD_ID, 0)::STRING) AS EVENT_THREAD_ID,
    COALESCE(NULLIF(i.THREAD_ID, '0'), NULLIF(r.THREAD_ID, '0'), NULLIF(u.THREAD_ID, 0)::STRING,
             u.PARENT_REQUEST_ID, u.REQUEST_ID, i.TRACE_ID)                         AS THREAD_ID,
    CASE WHEN NULLIF(i.THREAD_ID, '0') IS NOT NULL OR NULLIF(r.THREAD_ID, '0') IS NOT NULL THEN 'EVENT'
         WHEN NULLIF(u.THREAD_ID, 0) IS NOT NULL THEN 'USAGE_THREAD_ID'
         WHEN u.PARENT_REQUEST_ID IS NOT NULL THEN 'PARENT_REQUEST_ID'
         ELSE 'SELF' END                                                           AS THREAD_ID_SOURCE,
    i.MESSAGE_ID, i.PARENT_MESSAGE_ID, i.RECORD_ID, u.PARENT_REQUEST_ID,
    CASE WHEN u.SOURCE_VIEW IS NULL THEN 'TRACE_ONLY'
         WHEN u.SOURCE_VIEW = 'CORTEX_AGENT_USAGE_HISTORY' THEN 'AGENT_API'
         ELSE 'COWORK_UI' END                                                        AS SOURCE,
    COALESCE(CASE WHEN u.SOURCE_VIEW <> 'CORTEX_AGENT_USAGE_HISTORY' THEN 'cowork_ui' END,
             u.METADATA:interaction_interface::STRING,
             IFF(i.RECORD_NAME = 'AgentPassthroughRequestResponseInfo', 'passthrough', NULL), 'unknown') AS INTERFACE,
    u.SOURCE_VIEW, u.COWORK_ID, u.COWORK_NAME,
    COALESCE(u.AGENT_DATABASE_NAME, i.AGENT_DATABASE_NAME) AS AGENT_DATABASE_NAME,
    COALESCE(u.AGENT_SCHEMA_NAME,   i.AGENT_SCHEMA_NAME)   AS AGENT_SCHEMA_NAME,
    COALESCE(u.AGENT_NAME,          i.AGENT_NAME)          AS AGENT_NAME,
    COALESCE(u.AGENT_ID,            i.AGENT_ID)            AS AGENT_ID,
    COALESCE(u.METADATA:agent_version_name::STRING, i.AGENT_VERSION_NAME) AS AGENT_VERSION_NAME,
    u.METADATA:agent_version_alias::STRING       AS AGENT_VERSION_ALIAS,
    u.METADATA:agent_version_is_default::BOOLEAN AS AGENT_VERSION_IS_DEFAULT,
    COALESCE(u.USER_ID, r.USER_ID, i.USER_ID)       AS USER_ID,
    COALESCE(u.USER_NAME, r.USER_NAME, i.USER_NAME) AS USER_NAME,
    COALESCE(u.METADATA:role_name::STRING, r.ROLE_NAME) AS ROLE_NAME,
    r.SESSION_ID,
    u.METADATA:trigger_type::STRING AS TRIGGER_TYPE,
    COALESCE(CONVERT_TIMEZONE('UTC', u.START_TIME)::TIMESTAMP_NTZ, i.START_TS_UTC) AS START_TIME_UTC,
    COALESCE(CONVERT_TIMEZONE('UTC', u.END_TIME)::TIMESTAMP_NTZ,   i.END_TS_UTC)   AS END_TIME_UTC,
    DATEDIFF(millisecond, u.START_TIME, u.END_TIME)                         AS DURATION_MS,
    i.ATTRS:"snow.ai.observability.agent.duration"::NUMBER                   AS AGENT_DURATION_MS,
    i.ATTRS:"snow.ai.observability.agent.status.code"::STRING                AS STATUS_CODE,
    i.ATTRS:"snow.ai.observability.agent.status.description"::STRING         AS STATUS_DESCRIPTION,
    i.ATTRS:"snow.ai.observability.agent.research_mode"::STRING              AS RESEARCH_MODE,
    i.ATTRS:"snow.ai.observability.agent.tool_choice.type"::STRING           AS TOOL_CHOICE_TYPE,
    i.ATTRS:"snow.ai.observability.agent.first_message_in_thread"::STRING    AS FIRST_MESSAGE_IN_THREAD, -- content
    i.ATTRS:"ai.observability.record_root.input"::STRING                     AS QUESTION,               -- content
    -- Stored unmasked (computed at refresh), so metadata-tier viewers can still join to question themes.
    SHA2(i.ATTRS:"ai.observability.record_root.input"::STRING)               AS QUESTION_HASH,
    i.ATTRS:"snow.ai.observability.agent.response"::STRING                   AS RESPONSE,               -- content
    i.ATTRS:"snow.ai.observability.agent.thinking_response"::STRING          AS THINKING,               -- content
    TRY_PARSE_JSON(i.ATTRS:"snow.ai.observability.agent.suggested_queries"::STRING) AS SUGGESTED_QUERIES, -- content
    u.TOKENS, u.TOKEN_CREDITS,
    u.METADATA:ai_functions_credits::FLOAT AS AI_FUNCTIONS_CREDITS,
    u.METADATA:sql_query_credits::FLOAT    AS SQL_QUERY_CREDITS,
    u.TOKEN_CREDITS + COALESCE(u.METADATA:ai_functions_credits::FLOAT,0)
      + COALESCE(u.METADATA:sql_query_credits::FLOAT,0)                      AS COMBINED_CREDITS,
    u.METADATA:sql_query_warehouses AS SQL_QUERY_WAREHOUSES,
    u.METADATA:inference_region::STRING AS INFERENCE_REGION,
    mu.TI AS TOKENS_INPUT, mu.TO_ AS TOKENS_OUTPUT, mu.TCR AS TOKENS_CACHE_READ, mu.TCW AS TOKENS_CACHE_WRITE,
    mu.MODELS AS BILLED_MODELS,
    r.TRACE_TOKENS_TOTAL,
    sp.PLANNING_STEPS, sp.TOOL_CALLS, sp.SQL_CALLS, sp.SQL_ERRORS, sp.VERIFIED_QUERY_HITS, sp.SEARCH_CALLS,
    sp.WEB_SEARCH_CALLS, sp.CODE_EXEC_CALLS, sp.ERROR_SPANS, sp.SPAN_COUNT, sp.TOOLS_USED, sp.TRACE_MODELS,
    sp.PLANNING_MS, sp.RESPONSE_MS, sp.TOOL_MS,
    u.USER_TAGS, u.AGENT_TAGS, u.METADATA AS USAGE_METADATA,
    COALESCE(tc.TURNS_IN_TRACE, 0) > 1 AS IS_SHARED_TRACE,
    (u.REQUEST_ID IS NOT NULL) AS HAS_USAGE,
    (i.TRACE_ID IS NOT NULL)   AS HAS_TRACE
  FROM AGENT_OBS.RAW.USAGE_TURN u
  FULL OUTER JOIN info i ON i.REQUEST_ID = u.REQUEST_ID
  LEFT JOIN req   r  ON r.RECORD_ID = i.RECORD_ID
  -- A client may reuse one trace id for a whole conversation; trace-wide span stats would then be
  -- repeated on every turn, so they are only attached when the trace belongs to exactly one turn.
  LEFT JOIN (SELECT TRACE_ID, COUNT(*) AS TURNS_IN_TRACE FROM info WHERE TRACE_ID IS NOT NULL GROUP BY 1) tc ON tc.TRACE_ID = i.TRACE_ID
  LEFT JOIN spans sp ON sp.TRACE_ID = i.TRACE_ID AND tc.TURNS_IN_TRACE = 1
  LEFT JOIN mu       ON mu.REQUEST_ID = u.REQUEST_ID
  -- Passthrough traces with no usage row are Cortex Code (CoCo) requests: they own no agent
  -- object and are tracked from RAW.CODE_USAGE instead. CoWork's default agent also runs as
  -- passthrough but is billed in usage, so it stays.
  WHERE NOT (u.REQUEST_ID IS NULL AND i.RECORD_NAME = 'AgentPassthroughRequestResponseInfo')
)
SELECT j.*,
  IFF(j.AGENT_NAME IS NULL, NULL,
      '"' || j.AGENT_DATABASE_NAME || '"."' || j.AGENT_SCHEMA_NAME || '"."' || j.AGENT_NAME || '"') AS AGENT_FQN,
  -- Stand-in key for turns without an agent object (parenthesised so it can't collide with an FQN)
  IFF(j.AGENT_NAME IS NOT NULL, NULL,
      CASE WHEN j.COWORK_NAME IS NOT NULL OR j.INTERFACE = 'cowork_ui' THEN '(CoWork default agent)'
           ELSE '(inline API agent)' END) AS NO_AGENT_LABEL,
  ROW_NUMBER() OVER (PARTITION BY j.THREAD_ID ORDER BY j.START_TIME_UTC, j.TURN_ID) AS TURN_NUMBER,
  -- The assistant message produced by this turn is what the next turn replies to (and what feedback rates).
  LEAD(j.PARENT_MESSAGE_ID) OVER (PARTITION BY j.THREAD_ID ORDER BY j.START_TIME_UTC, j.TURN_ID) AS ASSISTANT_MESSAGE_ID,
  -- Success: trace status OK and no unrecovered tool failure (every SQL attempt failed = unrecovered).
  -- Turns without a trace count as success when billed.
  CASE WHEN j.HAS_TRACE THEN COALESCE(TRY_TO_NUMBER(j.STATUS_CODE), 200) < 400
                             AND NOT (COALESCE(j.SQL_CALLS, 0) > 0 AND j.SQL_ERRORS = j.SQL_CALLS)
       ELSE TRUE END AS IS_SUCCESS,
  DIV0NULL(j.TOKENS_CACHE_READ, COALESCE(j.TOKENS_INPUT,0) + COALESCE(j.TOKENS_CACHE_READ,0)
           + COALESCE(j.TOKENS_CACHE_WRITE,0)) AS CACHE_SHARE
FROM j;

-- ---------------------------------------------------------------------
-- FACT_SQL_EXECUTION
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE CORE.FACT_SQL_EXECUTION
  TARGET_LAG = DOWNSTREAM WAREHOUSE = AGENT_OBS_WH REFRESH_MODE = INCREMENTAL
AS
SELECT
  s.EVENT_HASH, s.TRACE_ID, s.SPAN_ID, s.THREAD_ID, s.REQUEST_ID,
  s.AGENT_DATABASE_NAME, s.AGENT_SCHEMA_NAME, s.AGENT_NAME, s.AGENT_VERSION_NAME,
  s.SPAN_NAME, s.TOOL_NAME, s.RESOURCE_FQN AS SEMANTIC_MODEL, s.START_TS_UTC, s.END_TS_UTC,
  COALESCE(s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.duration"::NUMBER, s.DURATION_MS) AS DURATION_MS,
  s.QUERY_ID,
  s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.warehouse"::STRING AS WAREHOUSE,
  s.VERIFIED_QUERY_USED,
  s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.skill_used"::STRING AS SKILL_USED,
  s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.result_truncated"::BOOLEAN AS RESULT_TRUNCATED,
  s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.result.num_rows"::NUMBER AS RESULT_ROWS,
  s.TOOL_STATUS_CODE AS STATUS_CODE,
  s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.status.description"::STRING AS STATUS_DESCRIPTION,
  s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.execution_status"::STRING   AS EXECUTION_STATUS,
  ARRAY_CONSTRUCT_COMPACT(
    s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.validation_error.0.message"::STRING,
    s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.validation_error.1.message"::STRING,
    s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.validation_error.2.message"::STRING,
    s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.validation_error.3.message"::STRING,
    s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.validation_error.4.message"::STRING) AS VALIDATION_ERRORS, -- content
  (s.IS_SQL_ERROR OR (s.SPAN_NAME = 'SqlExecution_CortexAnalyst' AND s.TOOL_STATUS_CODE <> '200')) AS IS_ERROR,
  (s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.validation_error.0.message" IS NOT NULL) AS HAS_VALIDATION_ISSUE,
  s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.error_correction"::STRING AS ERROR_CORRECTION,   -- content
  COALESCE(s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.final_sql",
           s.ATTRS:"snow.ai.observability.agent.tool.sql_execution.query")::STRING AS FINAL_SQL,         -- content
  q.WAREHOUSE_NAME AS QH_WAREHOUSE_NAME, q.WAREHOUSE_SIZE AS QH_WAREHOUSE_SIZE, q.EXECUTION_STATUS AS QH_EXECUTION_STATUS,
  q.ERROR_MESSAGE AS QH_ERROR_MESSAGE, q.TOTAL_ELAPSED_TIME AS QH_TOTAL_ELAPSED_MS, q.EXECUTION_TIME AS QH_EXECUTION_MS,
  q.COMPILATION_TIME AS QH_COMPILATION_MS, q.QUEUED_OVERLOAD_TIME AS QH_QUEUED_MS, q.BYTES_SCANNED AS QH_BYTES_SCANNED,
  q.ROWS_PRODUCED AS QH_ROWS_PRODUCED, q.PARTITIONS_SCANNED AS QH_PARTITIONS_SCANNED, q.PARTITIONS_TOTAL AS QH_PARTITIONS_TOTAL
FROM CORE.FACT_SPAN s
LEFT JOIN AGENT_OBS.RAW.AGENT_QUERY_HISTORY q ON q.QUERY_ID = s.QUERY_ID
WHERE s.SPAN_CATEGORY = 'sql' OR s.SPAN_NAME = 'SqlExecution_CortexAnalyst';

-- ---------------------------------------------------------------------
-- FACT_SEARCH_CALL
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE CORE.FACT_SEARCH_CALL
  TARGET_LAG = DOWNSTREAM WAREHOUSE = AGENT_OBS_WH REFRESH_MODE = INCREMENTAL
AS
SELECT
  s.EVENT_HASH, s.TRACE_ID, s.SPAN_ID, s.THREAD_ID, s.REQUEST_ID,
  s.AGENT_DATABASE_NAME, s.AGENT_SCHEMA_NAME, s.AGENT_NAME, s.AGENT_VERSION_NAME,
  s.SPAN_NAME, s.TOOL_NAME, s.RESOURCE_FQN AS SEARCH_SERVICE_FQN,
  s.ATTRS:"snow.ai.observability.agent.tool.cortex_search.service_id"::STRING AS SERVICE_ID,
  s.START_TS_UTC, s.END_TS_UTC,
  COALESCE(s.ATTRS:"snow.ai.observability.agent.tool.cortex_search.duration"::NUMBER, s.DURATION_MS) AS DURATION_MS,
  s.ATTRS:"snow.ai.observability.agent.tool.cortex_search.limit"::NUMBER AS RESULT_LIMIT,
  ARRAY_SIZE(TRY_PARSE_JSON(s.ATTRS:"snow.ai.observability.agent.tool.cortex_search.results"::STRING)) AS RESULT_COUNT,
  s.TOOL_STATUS_CODE AS STATUS_CODE, s.IS_ERROR,
  s.ATTRS:"snow.ai.observability.agent.tool.cortex_search.query"::STRING   AS SEARCH_QUERY,   -- content
  s.ATTRS:"snow.ai.observability.agent.tool.cortex_search.results"::STRING AS RESULTS         -- content
FROM CORE.FACT_SPAN s
WHERE s.SPAN_CATEGORY = 'search' AND s.RESOURCE_FQN IS NOT NULL;

-- ---------------------------------------------------------------------
-- FACT_FEEDBACK (record_id = rated assistant message id)
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE CORE.FACT_FEEDBACK
  TARGET_LAG = DOWNSTREAM WAREHOUSE = AGENT_OBS_WH REFRESH_MODE = FULL
AS
WITH fb AS (
  SELECT EVENT_HASH, END_TS_UTC AS FEEDBACK_TS_UTC, RECORD_ID AS RATED_MESSAGE_ID, THREAD_ID,
         AGENT_DATABASE_NAME, AGENT_SCHEMA_NAME, AGENT_NAME, USER_ID, USER_NAME, ROLE_NAME,
         EVENT_VALUE:positive::BOOLEAN        AS IS_POSITIVE,
         EVENT_VALUE:entity_type::STRING      AS ENTITY_TYPE,
         EVENT_VALUE:feedback_message::STRING AS FEEDBACK_TEXT,   -- content
         EVENT_VALUE                          AS FEEDBACK_VALUE   -- content
  FROM CORE.EVENT_AGENT WHERE RECORD_NAME = 'CORTEX_AGENT_FEEDBACK'
)
SELECT fb.*,
       COALESCE(exact.TURN_ID, approx.TURN_ID) AS TURN_ID,
       IFF(exact.TURN_ID IS NOT NULL, 'ASSISTANT_MESSAGE_ID', IFF(approx.TURN_ID IS NOT NULL, 'LATEST_TURN_IN_THREAD', NULL)) AS TURN_MATCH
FROM fb
LEFT JOIN CORE.FACT_TURN exact ON exact.ASSISTANT_MESSAGE_ID = fb.RATED_MESSAGE_ID
LEFT JOIN CORE.FACT_TURN approx ON approx.EVENT_THREAD_ID = fb.THREAD_ID AND approx.START_TIME_UTC <= fb.FEEDBACK_TS_UTC
QUALIFY ROW_NUMBER() OVER (PARTITION BY fb.EVENT_HASH ORDER BY approx.START_TIME_UTC DESC NULLS LAST) = 1;

-- ---------------------------------------------------------------------
-- FACT_THREAD
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE CORE.FACT_THREAD
  TARGET_LAG = DOWNSTREAM WAREHOUSE = AGENT_OBS_WH REFRESH_MODE = FULL
AS
WITH f AS (
  SELECT TURN_ID, COUNT_IF(IS_POSITIVE) POS, COUNT_IF(NOT IS_POSITIVE) NEG FROM CORE.FACT_FEEDBACK GROUP BY 1
)
SELECT t.THREAD_ID, ANY_VALUE(t.THREAD_ID_SOURCE) AS THREAD_ID_SOURCE,
       MIN_BY(t.QUESTION, t.TURN_NUMBER) AS FIRST_QUESTION,                          -- content
       MIN_BY(t.AGENT_FQN, t.TURN_NUMBER) AS FIRST_AGENT_FQN,
       MIN_BY(t.NO_AGENT_LABEL, t.TURN_NUMBER) AS NO_AGENT_LABEL,
       ARRAY_AGG(DISTINCT t.AGENT_FQN)          AS AGENT_FQNS,
       ARRAY_AGG(DISTINCT t.AGENT_VERSION_NAME) AS AGENT_VERSIONS,
       COUNT(DISTINCT t.AGENT_VERSION_NAME) > 1 AS IS_MULTI_VERSION,
       ARRAY_AGG(DISTINCT t.USER_NAME)          AS USER_NAMES,
       MIN_BY(t.USER_NAME, t.TURN_NUMBER)       AS USER_NAME,
       MIN_BY(t.INTERFACE, t.TURN_NUMBER)       AS INTERFACE,
       COUNT(*) AS TURNS, MIN(t.START_TIME_UTC) AS STARTED_AT_UTC, MAX(t.END_TIME_UTC) AS LAST_UPDATED_UTC,
       DATEDIFF(second, MIN(t.START_TIME_UTC), MAX(t.END_TIME_UTC)) AS DURATION_S,
       SUM(t.COMBINED_CREDITS) AS COMBINED_CREDITS, SUM(t.TOKENS) AS TOKENS,
       COUNT_IF(NOT t.IS_SUCCESS) AS FAILED_TURNS, SUM(t.SQL_ERRORS) AS SQL_ERRORS,
       SUM(COALESCE(f.POS,0)) AS FEEDBACK_POSITIVE, SUM(COALESCE(f.NEG,0)) AS FEEDBACK_NEGATIVE,
       BOOLAND_AGG(t.HAS_TRACE) AS ALL_TURNS_TRACED
FROM CORE.FACT_TURN t LEFT JOIN f ON f.TURN_ID = t.TURN_ID
GROUP BY t.THREAD_ID;

-- ---------------------------------------------------------------------
-- Dimensions (views over RAW history; cheap, always current)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW CORE.DIM_AGENT COMMENT = 'SCD2 agent config with derived capability flags' AS
SELECT
  h.AGENT_FQN, h.DATABASE_NAME, h.SCHEMA_NAME, h.AGENT_NAME,
  COALESCE(NULLIF(h.PROFILE:display_name::STRING,''), h.AGENT_NAME) AS DISPLAY_NAME,
  h.PROFILE:avatar::STRING AS AVATAR, h.PROFILE:color::STRING AS COLOR,
  h.OWNER, h.COMMENT, h.CREATED_ON, h.IS_SECURE, h.DEFAULT_VERSION_NAME, h.VERSIONS, h.ALIASES,
  ARRAY_SIZE(h.VERSIONS) AS VERSION_COUNT,
  NULLIF(h.AGENT_SPEC:models:orchestration::STRING, '') AS ORCHESTRATION_MODEL,
  h.AGENT_SPEC:orchestration:budget:seconds::NUMBER AS BUDGET_SECONDS,
  h.AGENT_SPEC:orchestration:budget:tokens::NUMBER  AS BUDGET_TOKENS,
  (h.AGENT_SPEC:orchestration:budget IS NULL) AS IS_BUDGET_UNBOUNDED,
  COALESCE(h.AGENT_SPEC:orchestration:capabilities:analytical_search IS NOT NULL, FALSE) AS HAS_ANALYTICAL_SEARCH,
  ARRAY_SIZE(COALESCE(h.AGENT_SPEC:tools, [])) AS TOOL_COUNT,
  REGEXP_COUNT(h.AGENT_SPEC:tools::STRING, '"type":"cortex_analyst_text_to_sql"') AS ANALYST_TOOL_COUNT,
  REGEXP_COUNT(h.AGENT_SPEC:tools::STRING, '"type":"cortex_search"')              AS SEARCH_TOOL_COUNT,
  REGEXP_COUNT(h.AGENT_SPEC:tools::STRING, '"type":"generic"')                    AS CUSTOM_TOOL_COUNT,
  h.AGENT_SPEC:tools::STRING ILIKE '%"type":"web_search"%'      AS HAS_WEB_SEARCH,
  h.AGENT_SPEC:tools::STRING ILIKE '%"type":"code_execution"%'  AS HAS_CODE_EXECUTION,
  h.AGENT_SPEC:tools::STRING ILIKE '%"type":"data_to_chart"%'   AS HAS_CHARTS,
  h.AGENT_SPEC:tools::STRING ILIKE '%"type":"%mcp%'            AS HAS_MCP,
  h.AGENT_SPEC::STRING ILIKE '%"memory"%'                       AS HAS_MEMORY,
  ARRAY_SIZE(COALESCE(h.AGENT_SPEC:skills, [])) AS SKILL_COUNT,
  LENGTH(h.AGENT_SPEC:instructions:system::STRING)        AS INSTR_SYSTEM_LEN,
  LENGTH(h.AGENT_SPEC:instructions:orchestration::STRING) AS INSTR_ORCHESTRATION_LEN,
  LENGTH(h.AGENT_SPEC:instructions:response::STRING)      AS INSTR_RESPONSE_LEN,
  ARRAY_SIZE(COALESCE(h.AGENT_SPEC:instructions:sample_questions, [])) AS SAMPLE_QUESTION_COUNT,
  h.AGENT_SPEC, h.CONFIG_HASH, h.VALID_FROM, h.VALID_TO, h.IS_CURRENT, h.IS_DROPPED, h.DESCRIBE_ERROR
FROM AGENT_OBS.RAW.AGENT_CONFIG_HISTORY h;

CREATE OR REPLACE VIEW CORE.DIM_AGENT_TOOL COMMENT = 'Agent config version × tool, with bound resource' AS
SELECT h.AGENT_FQN, h.VALID_FROM, h.VALID_TO, h.IS_CURRENT,
       t.index AS TOOL_INDEX,
       t.value:tool_spec:name::STRING AS TOOL_NAME,
       t.value:tool_spec:type::STRING AS TOOL_TYPE,
       t.value:tool_spec:description::STRING AS TOOL_DESCRIPTION,
       r AS TOOL_RESOURCE,
       COALESCE(r:semantic_view, r:search_service, r:semantic_model_file, r:identifier, r:name)::STRING AS RESOURCE_FQN,
       CASE WHEN r:semantic_view IS NOT NULL THEN 'SEMANTIC_VIEW'
            WHEN r:search_service IS NOT NULL OR t.value:tool_spec:type::STRING = 'cortex_search' THEN 'CORTEX_SEARCH_SERVICE'
            WHEN r:semantic_model_file IS NOT NULL THEN 'SEMANTIC_MODEL_FILE'
            WHEN r:identifier IS NOT NULL THEN 'FUNCTION_OR_PROCEDURE' END AS RESOURCE_TYPE,
       r:execution_environment:warehouse::STRING AS WAREHOUSE
FROM AGENT_OBS.RAW.AGENT_CONFIG_HISTORY h,
     LATERAL FLATTEN(INPUT => h.AGENT_SPEC:tools) t,
     LATERAL (SELECT GET(h.AGENT_SPEC:tool_resources, t.value:tool_spec:name::STRING) AS r) x;

CREATE OR REPLACE VIEW CORE.DIM_ASSET COMMENT = 'Semantic views & search services: latest snapshot + lifecycle' AS
SELECT ASSET_TYPE, ASSET_FQN, DATABASE_NAME, SCHEMA_NAME, ASSET_NAME,
       MAX_BY(OWNER, SNAPSHOT_DATE) AS OWNER, MAX_BY(COMMENT, SNAPSHOT_DATE) AS COMMENT,
       MAX_BY(CREATED_ON, SNAPSHOT_DATE) AS CREATED_ON,
       MAX_BY(VERIFIED_QUERY_COUNT, SNAPSHOT_DATE) AS VERIFIED_QUERY_COUNT,
       MAX_BY(DETAILS, SNAPSHOT_DATE) AS DETAILS,
       MIN(SNAPSHOT_DATE) AS FIRST_SEEN, MAX(SNAPSHOT_DATE) AS LAST_SEEN,
       MAX(SNAPSHOT_DATE) < (SELECT MAX(SNAPSHOT_DATE) FROM AGENT_OBS.RAW.ASSET_SNAPSHOT) AS IS_DROPPED,
       -- Unquoted upper-case FQN for matching span/config references
       UPPER(DATABASE_NAME || '.' || SCHEMA_NAME || '.' || ASSET_NAME) AS ASSET_KEY
FROM AGENT_OBS.RAW.ASSET_SNAPSHOT
GROUP BY ASSET_TYPE, ASSET_FQN, DATABASE_NAME, SCHEMA_NAME, ASSET_NAME;

CREATE OR REPLACE VIEW CORE.DIM_USER AS
SELECT u.USER_ID, u.NAME AS USER_NAME, u.LOGIN_NAME, u.DISPLAY_NAME, u.EMAIL, u.TYPE AS USER_TYPE,
       u.DEFAULT_ROLE, u.DISABLED, u.CREATED_ON, u.DELETED_ON, u.LAST_SUCCESS_LOGIN, t.USER_TAGS
FROM AGENT_OBS.RAW.USERS u
LEFT JOIN (SELECT USER_ID, MAX_BY(USER_TAGS, START_TIME) USER_TAGS FROM AGENT_OBS.RAW.USAGE_TURN GROUP BY 1) t
  ON t.USER_ID = u.USER_ID;
