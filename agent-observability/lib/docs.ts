/**
 * Content for the Docs page. Every query here is meant to be copied into a
 * Snowsight worksheet and run as-is. "core" queries read Snowflake's own
 * metadata (ACCOUNT_USAGE, the AI observability event table, SHOW/DESCRIBE);
 * "mart" queries read the AGENT_OBS data mart this app is built on.
 * __tests__/lib/docs.test.ts checks the structure; scripts run every query.
 */

export type DocQuery = {
  id: string;
  title: string;
  /** What the query answers and anything to know before running it. */
  description: string;
  source: 'core' | 'mart';
  sql: string;
};

export type DocSection = {
  id: string;
  title: string;
  /** Short paragraphs. */
  intro: string[];
  /** Metric or concept → definition. */
  definitions?: [string, string][];
  queries: DocQuery[];
};

/** Variables every core query uses. Run this block first (or edit the values inline). */
export const VARIABLES_SQL = `-- Set once per worksheet; every query below uses these.
SET days  = 30;                                   -- look-back window
SET agent = 'MY_DB.MY_SCHEMA.MY_AGENT';           -- fully qualified agent name (DB.SCHEMA.NAME)
SET user_name = 'SOME_USER';                      -- Snowflake user name`;

export const DOC_SECTIONS: DocSection[] = [
  // ------------------------------------------------------------------ Getting started
  {
    id: 'getting-started',
    title: 'Getting started',
    intro: [
      'Agent Observability reads only the AGENT_OBS.MART schema. A pipeline copies Snowflake metadata into AGENT_OBS.RAW every 12 hours and keeps it forever, so history outlives the source views. Dynamic tables in AGENT_OBS.CORE then shape it into turns, threads, spans and themes.',
      'Every number in the app can be rebuilt from Snowflake’s own metadata. Each section below shows the core query against the source views, plus the equivalent query against the mart. Core queries return live data and are limited by each source’s retention. Mart queries return the full history but can lag the source by up to 12 hours.',
      'To run core queries you need ACCOUNTADMIN, or a role with IMPORTED PRIVILEGES on the SNOWFLAKE database, for ACCOUNT_USAGE. For the event table you need the AI_OBSERVABILITY_READER application role (or MONITOR on each agent, via the GET_AI_OBSERVABILITY_EVENTS function). Question, answer and SQL text in the event table also need READ UNREDACTED AI OBSERVABILITY EVENTS TABLE. Mart queries need AGENT_OBS_APP_ROLE, plus AGENT_OBS_CONTENT_ROLE for conversation text.',
      'Run the variables block once per worksheet; every core query below uses $days, $agent and $user_name. ACCOUNT_USAGE views lag 45 minutes to 3 hours behind real time.',
    ],
    definitions: [
      ['Turn', 'One user message and the agent’s full answer: one agent:run request, one trace.'],
      ['Thread', 'A conversation: the turns that share a thread id.'],
      ['Trace / span', 'The OpenTelemetry trace for a turn, made of spans: planning steps, tool calls, SQL execution, response generation.'],
      ['Credits', 'Authoritative AI credits from the usage views (tokens plus AI-function and SQL-query credits), never estimated from traces.'],
      ['Content tier', 'Questions, answers, SQL, prompts and feedback text. Masked unless the role has AGENT_OBS_CONTENT_ROLE.'],
    ],
    queries: [
      {
        id: 'sources-freshness',
        title: 'How fresh is each source?',
        description: 'Latest record in each Snowflake source view the app reads.',
        source: 'core',
        sql: `SELECT 'CORTEX_AGENT_USAGE_HISTORY' AS source, MAX(start_time)::TIMESTAMP_LTZ AS latest FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_USAGE_HISTORY
UNION ALL SELECT 'SNOWFLAKE_COWORK_USAGE_HISTORY', MAX(start_time)::TIMESTAMP_LTZ FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY
UNION ALL SELECT 'CORTEX_CODE_DESKTOP_USAGE_HISTORY', MAX(usage_time)::TIMESTAMP_LTZ FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_CODE_DESKTOP_USAGE_HISTORY
-- The event table stores UTC without a time zone, so label it as UTC before comparing.
UNION ALL SELECT 'AI_OBSERVABILITY_EVENTS', TO_TIMESTAMP_TZ(TO_VARCHAR(MAX(timestamp), 'YYYY-MM-DD HH24:MI:SS.FF3') || ' +00:00', 'YYYY-MM-DD HH24:MI:SS.FF3 TZH:TZM')::TIMESTAMP_LTZ FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS
UNION ALL SELECT 'TASK_HISTORY', MAX(scheduled_time)::TIMESTAMP_LTZ FROM SNOWFLAKE.ACCOUNT_USAGE.TASK_HISTORY
ORDER BY 1;`,
      },
      {
        id: 'mart-freshness',
        title: 'How fresh is the mart?',
        description: 'Data-through and last-load time for each RAW table (what the freshness banner shows).',
        source: 'mart',
        sql: `SELECT * FROM AGENT_OBS.MART.V_FRESHNESS ORDER BY source;`,
      },
    ],
  },

  // ------------------------------------------------------------------ Portfolio
  {
    id: 'portfolio',
    title: 'Portfolio',
    intro: [
      'The account at a glance: turns, threads, users, credits, tokens, latency, success and feedback for every agent, compared with the prior period of the same length. The agent leaderboard flags idle agents, cost outliers and success-rate regressions. AI spend by product adds Cortex Code and AI SQL functions so all AI credits are in one place.',
      'Turns and credits come from the usage views. One view covers CoWork turns and another covers every other interface (Agent API, admin UI, SQL function, evals), and they share REQUEST_ID with the event table. Cortex Code requests leave empty "passthrough" traces with no agent object, so they’re excluded from agent turns and counted from the Cortex Code usage views instead.',
    ],
    definitions: [
      ['Interface', 'cowork_ui for CoWork; otherwise METADATA:interaction_interface from CORTEX_AGENT_USAGE_HISTORY (agent_admin_ui, external, sql_function, eval, …).'],
      ['Success rate', 'Share of turns whose trace status is below 400 and that didn’t have every SQL attempt fail. Turns with no trace count as successful when billed.'],
      ['Cost outlier', 'Credits per turn more than 2× the median of agents with at least 5 turns in the last 30 days.'],
      ['Regression', 'Success rate at least 10 points lower than the prior 30 days, with 10+ turns in both periods.'],
      ['(CoWork default agent)', 'CoWork chats that didn’t pick an agent; they run on CoWork’s built-in agent, which isn’t a schema object.'],
    ],
    queries: [
      {
        id: 'turns-by-agent',
        title: 'Turns, users and credits by agent',
        description: 'The leaderboard, straight from both usage views. COMBINED credits = token credits + AI-function credits + SQL-query credits.',
        source: 'core',
        sql: `WITH u AS (
  SELECT 'CoWork' AS surface, request_id, user_name, agent_database_name, agent_schema_name, agent_name,
         token_credits, metadata, thread_id, start_time
  FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY
  UNION ALL
  SELECT COALESCE(metadata:interaction_interface::STRING, 'api'), request_id, user_name, agent_database_name, agent_schema_name,
         agent_name, token_credits, metadata, thread_id, start_time
  FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_USAGE_HISTORY
)
SELECT COALESCE(agent_database_name || '.' || agent_schema_name || '.' || agent_name, '(no agent object)') AS agent,
       COUNT(*)                     AS turns,
       COUNT(DISTINCT thread_id)    AS threads,
       COUNT(DISTINCT user_name)    AS users,
       ROUND(SUM(token_credits + COALESCE(metadata:ai_functions_credits::FLOAT, 0)
                 + COALESCE(metadata:sql_query_credits::FLOAT, 0)), 3) AS credits,
       ROUND(credits / NULLIF(turns, 0), 4) AS credits_per_turn,
       MAX(start_time)              AS last_used
FROM u
WHERE start_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
GROUP BY 1
ORDER BY turns DESC;`,
      },
      {
        id: 'turns-by-interface',
        title: 'Daily turns by interface',
        description: 'The "Daily turns by interface" chart.',
        source: 'core',
        sql: `SELECT TO_DATE(start_time) AS day, 'cowork_ui' AS interface, COUNT(*) AS turns
FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY
WHERE start_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP()) GROUP BY 1, 2
UNION ALL
SELECT TO_DATE(start_time), COALESCE(metadata:interaction_interface::STRING, 'unknown'), COUNT(*)
FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_USAGE_HISTORY
WHERE start_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP()) GROUP BY 1, 2
ORDER BY 1, 2;`,
      },
      {
        id: 'credits-by-model',
        title: 'Credits by model',
        description: 'CREDITS_GRANULAR is nested: step → sub-request → service type → model → {input, output, cache_read_input, cache_write_input}. This flattens it to model level.',
        source: 'core',
        sql: `SELECT c4.key AS model, c3.key AS service_type,
       ROUND(SUM(COALESCE(c4.value:input::FLOAT, 0) + COALESCE(c4.value:output::FLOAT, 0)
               + COALESCE(c4.value:cache_read_input::FLOAT, 0) + COALESCE(c4.value:cache_write_input::FLOAT, 0)), 3) AS credits
FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_USAGE_HISTORY u,
     LATERAL FLATTEN(u.credits_granular) c1, LATERAL FLATTEN(c1.value) c2,
     LATERAL FLATTEN(c2.value) c3, LATERAL FLATTEN(c3.value) c4
WHERE u.start_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
  AND c3.key <> 'start_time' AND IS_OBJECT(c3.value)
GROUP BY 1, 2
ORDER BY credits DESC;
-- Same shape in SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY.`,
      },
      {
        id: 'ai-spend-by-product',
        title: 'AI spend by product',
        description: 'All AI credits in one place: agents, CoWork, Cortex Code (three surfaces) and AI SQL functions.',
        source: 'core',
        sql: `SELECT 'Cortex Agents' AS product, SUM(token_credits) AS credits FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_USAGE_HISTORY
  WHERE start_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
UNION ALL SELECT 'CoWork', SUM(token_credits) FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY
  WHERE start_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
UNION ALL SELECT 'Cortex Code (Desktop)', SUM(token_credits) FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_CODE_DESKTOP_USAGE_HISTORY
  WHERE usage_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
UNION ALL SELECT 'Cortex Code (Snowsight)', SUM(token_credits) FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_CODE_SNOWSIGHT_USAGE_HISTORY
  WHERE usage_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
UNION ALL SELECT 'Cortex Code (CLI)', SUM(token_credits) FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_CODE_CLI_USAGE_HISTORY
  WHERE usage_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
UNION ALL SELECT 'AI functions', SUM(credits) FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AI_FUNCTIONS_USAGE_HISTORY
  WHERE start_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
ORDER BY credits DESC NULLS LAST;`,
      },
      {
        id: 'coco-by-user',
        title: 'Cortex Code requests and credits by user and surface',
        description: 'Cortex Code has no agent object; its usage is only in these three views.',
        source: 'core',
        sql: `SELECT surface, user_name, COUNT(*) AS requests, COUNT(DISTINCT thread_id) AS threads, ROUND(SUM(token_credits), 3) AS credits
FROM (
  SELECT 'Desktop' AS surface, * FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_CODE_DESKTOP_USAGE_HISTORY
  UNION ALL BY NAME SELECT 'Snowsight' AS surface, * FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_CODE_SNOWSIGHT_USAGE_HISTORY
  UNION ALL BY NAME SELECT 'CLI' AS surface, * FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_CODE_CLI_USAGE_HISTORY
)
WHERE usage_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
GROUP BY 1, 2
ORDER BY credits DESC;`,
      },
      {
        id: 'mart-leaderboard',
        title: 'Leaderboard from the mart',
        description: 'Same numbers with full history and flags precomputed.',
        source: 'mart',
        sql: `SELECT agent_fqn, display_name, turns, users, credits, credits_per_turn, success_rate, sql_error_rate,
       flag_idle, flag_cost_outlier, flag_quality_regression
FROM AGENT_OBS.MART.V_AGENT_LEADERBOARD_30D
ORDER BY turns DESC;

-- Daily grain for any window: AGENT_OBS.MART.AGG_AGENT_DAILY
-- AI spend by product:          AGENT_OBS.MART.V_AI_SPEND_DAILY
-- Cortex Code:                  AGENT_OBS.MART.V_CODE_USAGE_DAILY, V_CODE_MODEL_DAILY`,
      },
    ],
  },

  // ------------------------------------------------------------------ Trends
  {
    id: 'trends',
    title: 'Conversation trends',
    intro: [
      'What people ask each agent, grouped into themes. Each distinct question is classified once with AI_COMPLETE (structured output) into an intent, a business domain, metrics, dimensions and a canonical form. The canonical forms are embedded with AI_EMBED and near-duplicates (cosine similarity ≥ 0.88 by default) are grouped per agent. Each theme is then joined to its outcomes to flag opportunities.',
      'Question text lives in the AI observability event table, in the root span’s record_root.input attribute. The classification itself only exists in the mart, but you can run the same kind of analysis ad hoc with AI_CLASSIFY, as shown below.',
    ],
    definitions: [
      ['Add verified queries', 'Theme asked 3+ times, answered with SQL in 2+ turns, and a verified query was used in under half of them.'],
      ['Build reports', 'Metric-style theme asked 3+ times across 2+ weeks, or 3+ times by the same person.'],
      ['Fix gaps', 'Problem reports, or asked 2+ times with success < 80%, SQL error rate > 25% or any negative feedback.'],
      ['Help users', 'Asked 2+ times with a “what can I ask?” or definition / how-to intent.'],
      ['Rising', 'Asked 3+ times in the last 7 days and at least double the 7 days before.'],
    ],
    queries: [
      {
        id: 'questions-raw',
        title: 'Every question asked, with user and agent',
        description: 'The question text is content. Without READ UNREDACTED AI OBSERVABILITY EVENTS TABLE it comes back redacted.',
        source: 'core',
        sql: `SELECT e.timestamp                                                             AS asked_at_utc,
       e.record_attributes:"snow.ai.observability.database.name"::STRING || '.' ||
       e.record_attributes:"snow.ai.observability.schema.name"::STRING   || '.' ||
       e.record_attributes:"snow.ai.observability.object.name"::STRING   AS agent,
       COALESCE(u.user_name, c.user_name)                                      AS user_name,
       e.record_attributes:"ai.observability.record_root.input"::STRING        AS question,
       e.record_attributes:"snow.ai.observability.agent.status.code"::STRING   AS status_code,
       e.record_attributes:"snow.ai.observability.agent.request_id"::STRING    AS request_id,
       e.trace:trace_id::STRING                                                AS trace_id
FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS e
LEFT JOIN SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_USAGE_HISTORY u
       ON u.request_id = e.record_attributes:"snow.ai.observability.agent.request_id"::STRING
LEFT JOIN SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY c
       ON c.request_id = e.record_attributes:"snow.ai.observability.agent.request_id"::STRING
WHERE e.record:name::STRING = 'AgentV2RequestResponseInfo'
  AND e.timestamp >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
ORDER BY asked_at_utc DESC;`,
      },
      {
        id: 'top-questions-exact',
        title: 'Most repeated questions (exact text)',
        description: 'A quick look without AI: identical question text, counted. Themes in the app also merge different phrasings.',
        source: 'core',
        sql: `SELECT e.record_attributes:"snow.ai.observability.object.name"::STRING AS agent_name,
       LOWER(TRIM(e.record_attributes:"ai.observability.record_root.input"::STRING)) AS question,
       COUNT(*) AS times_asked, MIN(e.timestamp) AS first_asked, MAX(e.timestamp) AS last_asked
FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS e
WHERE e.record:name::STRING = 'AgentV2RequestResponseInfo'
  AND e.timestamp >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
GROUP BY 1, 2
HAVING COUNT(*) > 1
ORDER BY times_asked DESC
LIMIT 100;`,
      },
      {
        id: 'classify-adhoc',
        title: 'Classify questions yourself with AI_CLASSIFY',
        description: 'Runs one AI call per distinct question: check the count first and start with a LIMIT. The app uses a richer AI_COMPLETE prompt (see sql/08_trends.sql).',
        source: 'core',
        sql: `WITH q AS (
  SELECT DISTINCT e.record_attributes:"ai.observability.record_root.input"::STRING AS question
  FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS e
  WHERE e.record:name::STRING = 'AgentV2RequestResponseInfo'
    AND e.timestamp >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
    AND e.record_attributes:"snow.ai.observability.database.name"::STRING || '.' ||
        e.record_attributes:"snow.ai.observability.schema.name"::STRING   || '.' ||
        e.record_attributes:"snow.ai.observability.object.name"::STRING = $agent
  LIMIT 50
)
SELECT question,
       AI_CLASSIFY(question, ['metric lookup', 'breakdown by dimension', 'ranking / top N', 'trend over time',
                              'comparison', 'why / diagnostic', 'what can I ask', 'build a report or chart', 'other']):labels[0]::STRING AS intent
FROM q;`,
      },
      {
        id: 'verified-query-rate',
        title: 'Verified-query use by agent',
        description: 'Share of SQL executions that used a verified query: the input to the "Add verified queries" opportunity.',
        source: 'core',
        sql: `SELECT e.record_attributes:"snow.ai.observability.object.name"::STRING AS agent_name,
       COUNT(*) AS sql_executions,
       COUNT_IF(e.record_attributes:"snow.ai.observability.agent.tool.sql_execution.verified_query_used"::BOOLEAN) AS used_verified_query,
       ROUND(used_verified_query / NULLIF(sql_executions, 0), 3) AS verified_query_rate
FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS e
WHERE e.record_type = 'SPAN'
  AND e.record_attributes:"snow.ai.observability.agent.tool.sql_execution.query_id" IS NOT NULL
  AND e.timestamp >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
GROUP BY 1
ORDER BY sql_executions DESC;`,
      },
      {
        id: 'mart-themes',
        title: 'Themes and classification from the mart',
        description: 'One row per turn with its intent, domain, theme and outcome signals.',
        source: 'mart',
        sql: `SELECT agent_key, theme_label, intent, domain,
       COUNT(*) AS asks, COUNT(DISTINCT user_id) AS people,
       ROUND(COUNT_IF(verified_query_hits > 0) / NULLIF(COUNT_IF(sql_calls > 0), 0), 2) AS verified_query_rate
FROM AGENT_OBS.MART.V_QUESTION_TURN
WHERE NOT is_noise AND start_time_utc >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
GROUP BY 1, 2, 3, 4
ORDER BY asks DESC;

-- Classification per distinct question: AGENT_OBS.RAW.QUESTION_ENRICHMENT
-- Theme membership:                    AGENT_OBS.CORE.QUESTION_CLUSTER`,
      },
    ],
  },

  // ------------------------------------------------------------------ End users
  {
    id: 'end-users',
    title: 'End users',
    intro: [
      'Who uses the agents, what they ask, what it costs and where they get stuck. By default only people are shown. The toggle adds service and app accounts, which are users whose TYPE is SERVICE / LEGACY_SERVICE / SNOWFLAKE_SERVICE or whose name looks like an app (SF$SERVICE$…, MANAGED_SERVICE_…, *_SVC, *_APP, *_API), and the SYSTEM process. An app that calls an agent on behalf of its own end users appears as one account.',
      'Click any user for a profile: activity, agents, themes, dashboard opportunities, issues, feedback and their latest questions.',
    ],
    definitions: [
      ['New user', 'First turn ever falls inside the selected range.'],
      ['Issue', 'A turn that failed, had every SQL attempt fail, recovered from a SQL error, got negative feedback, or was itself a problem report (“it’s blank”, “that’s wrong”).'],
      ['Power user', '20+ questions on 5+ distinct days.'],
      ['Struggling', '2+ issues and an issue rate of 20%+, or any negative feedback.'],
      ['Needs onboarding', '30%+ of questions are “what can I ask?” or definitions.'],
      ['Dashboard opportunity', 'The same person asked the same metric-style theme 3+ times on 2+ different days.'],
    ],
    queries: [
      {
        id: 'users-activity',
        title: 'Activity and credits per user',
        description: 'Joins usage to USERS to tell people from service accounts.',
        source: 'core',
        sql: `WITH turns AS (
  SELECT user_name, request_id, thread_id, start_time, agent_name,
         token_credits + COALESCE(metadata:ai_functions_credits::FLOAT, 0) + COALESCE(metadata:sql_query_credits::FLOAT, 0) AS credits
  FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_USAGE_HISTORY
  UNION ALL
  SELECT user_name, request_id, thread_id, start_time, agent_name,
         token_credits + COALESCE(metadata:ai_functions_credits::FLOAT, 0) + COALESCE(metadata:sql_query_credits::FLOAT, 0)
  FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY
)
SELECT t.user_name, u.type AS user_type,
       COUNT(*) AS turns, COUNT(DISTINCT t.thread_id) AS threads, COUNT(DISTINCT TO_DATE(t.start_time)) AS active_days,
       COUNT(DISTINCT t.agent_name) AS agents, ROUND(SUM(t.credits), 3) AS credits,
       MIN(t.start_time) AS first_seen, MAX(t.start_time) AS last_seen
FROM turns t
LEFT JOIN SNOWFLAKE.ACCOUNT_USAGE.USERS u ON u.name = t.user_name AND u.deleted_on IS NULL
WHERE t.start_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
GROUP BY 1, 2
ORDER BY turns DESC;`,
      },
      {
        id: 'user-sql-errors',
        title: 'SQL errors a user hit',
        description: 'SQL tool spans for one user that returned a non-200 status or weren’t executed.',
        source: 'core',
        sql: `SELECT e.timestamp, e.record_attributes:"snow.ai.observability.object.name"::STRING AS agent_name,
       e.record_attributes:"snow.ai.observability.agent.tool.sql_execution.status.code"::STRING AS status_code,
       e.record_attributes:"snow.ai.observability.agent.tool.sql_execution.execution_status"::STRING AS execution_status,
       e.record_attributes:"snow.ai.observability.agent.tool.sql_execution.query_id"::STRING AS query_id,
       e.trace:trace_id::STRING AS trace_id
FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS e
WHERE e.record_type = 'SPAN'
  AND e.record_attributes:"snow.ai.observability.agent.tool.sql_execution.query_id" IS NOT NULL
  AND (e.record_attributes:"snow.ai.observability.agent.tool.sql_execution.status.code"::STRING <> '200'
       OR e.record_attributes:"snow.ai.observability.agent.tool.sql_execution.execution_status"::STRING ILIKE 'SQL was NOT executed%')
  AND e.trace:trace_id::STRING IN (
        SELECT trace:trace_id::STRING FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS
        WHERE COALESCE(record_attributes:"snow.ai.observability.user.name", resource_attributes:"snow.user.name")::STRING = $user_name)
  AND e.timestamp >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
ORDER BY e.timestamp DESC;`,
      },
      {
        id: 'feedback',
        title: 'User feedback (thumbs up / down and comments)',
        description: 'Feedback events have no trace id; record_id is the rated assistant message.',
        source: 'core',
        sql: `SELECT timestamp AS feedback_at_utc,
       COALESCE(record_attributes:"snow.ai.observability.user.name", resource_attributes:"snow.user.name")::STRING AS user_name,
       record_attributes:"snow.ai.observability.object.name"::STRING AS agent_name,
       value:positive::BOOLEAN          AS is_positive,
       value:feedback_message::STRING   AS comment,
       record_attributes:"snow.ai.observability.agent.thread_id"::STRING AS thread_id
FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS
WHERE record:name::STRING = 'CORTEX_AGENT_FEEDBACK'
  AND timestamp >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
ORDER BY feedback_at_utc DESC;`,
      },
      {
        id: 'mart-end-users',
        title: 'End users from the mart',
        description: 'Turn-level user activity with account kind, theme and issue reason already attached.',
        source: 'mart',
        sql: `SELECT user_name, account_kind, COUNT(*) AS turns, COUNT(DISTINCT day) AS active_days,
       ROUND(SUM(combined_credits), 3) AS credits, COUNT(issue_reason) AS issues,
       SUM(feedback_positive) AS thumbs_up, SUM(feedback_negative) AS thumbs_down
FROM AGENT_OBS.MART.V_END_USER_TURN
WHERE day > DATEADD(day, -$days, CURRENT_DATE())
GROUP BY 1, 2
ORDER BY turns DESC;`,
      },
    ],
  },

  // ------------------------------------------------------------------ Automations
  {
    id: 'automations',
    title: 'Automations',
    intro: [
      'Scheduled automations users create. Each is a task in the user’s personal database (USER$<name>):',
      'CoWork automations live in USER$<name>.SNOWFLAKE_INTELLIGENCE and run SYSTEM$CORTEX_DATA_AGENT_RUN_V2(\'<agent>\', \'<request json>\'). The target agent and the prompt are parsed out of the task definition. Cortex Code automations are agent tasks in USER$<name>.PUBLIC named COCO_ROUTINE_*. Automations created with the Cortex Agent SDK are agent tasks in USER$<name>.PUBLIC.',
      'Run state, timing, errors and query ids come from TASK_HISTORY; task compute from SERVERLESS_TASK_HISTORY. The agent or Cortex Code credits for a run are the usage rows with METADATA:trigger_type = \'automation\' for the same user (and agent) that start within the run’s window. Automation threads and run history are kept only two months, but the mart keeps them indefinitely.',
    ],
    definitions: [
      ['Healthy', 'Running on schedule, no failures in 30 days.'],
      ['Flaky', 'Last run succeeded, but there were failures in the last 30 days.'],
      ['Failing', 'The most recent run failed.'],
      ['Auto-suspended', 'Suspended by Snowflake after repeated failures (LAST_SUSPENDED_REASON).'],
      ['Paused', 'Suspended by its owner.'],
    ],
    queries: [
      {
        id: 'cowork-automations',
        title: 'CoWork automations for all users',
        description: 'Includes the target agent and the prompt parsed from the task definition.',
        source: 'core',
        sql: `SELECT task_database, task_schema, task_name, comment AS title, task_owner, state, schedule, created, last_altered,
       REGEXP_SUBSTR(definition, 'CORTEX_DATA_AGENT_RUN(_V2)?\\\\(\\\\s*''([^'']+)''', 1, 1, 'ie', 2) AS target_agent,
       TRY_PARSE_JSON(REPLACE(REGEXP_SUBSTR(definition, 'CORTEX_DATA_AGENT_RUN(_V2)?\\\\(\\\\s*''[^'']+''\\\\s*,\\\\s*''(\\\\{.*\\\\})''', 1, 1, 'is', 2), '''''', ''''))
         :messages[0]:content[0]:text::STRING AS prompt
FROM SNOWFLAKE.ACCOUNT_USAGE.TASKS
WHERE deleted IS NULL
  AND task_database ILIKE 'USER$%'
  AND task_schema = 'SNOWFLAKE_INTELLIGENCE'
ORDER BY task_database, task_schema, task_name;`,
      },
      {
        id: 'coco-automations',
        title: 'Cortex Code automations for all users',
        description: 'CoCo routines are agent tasks with a COCO_ROUTINE_ prefix.',
        source: 'core',
        sql: `SELECT task_database, task_schema, task_name, comment AS title, task_owner, state, schedule, created, last_altered
FROM SNOWFLAKE.ACCOUNT_USAGE.TASKS
WHERE deleted IS NULL
  AND task_database ILIKE 'USER$%'
  AND task_schema = 'PUBLIC'
  AND UPPER(task_name) LIKE 'COCO\\\\_ROUTINE\\\\_%' ESCAPE '\\\\'
ORDER BY task_database, task_schema, task_name;`,
      },
      {
        id: 'automation-runs',
        title: 'Run history and failures',
        description: 'Every run of every user automation, newest first. Filter state = \'FAILED\' for failures.',
        source: 'core',
        sql: `SELECT h.database_name, h.schema_name, h.name AS task_name, h.scheduled_time, h.query_start_time, h.completed_time,
       DATEDIFF(second, h.query_start_time, h.completed_time) AS duration_s,
       h.state, h.error_code, h.error_message, h.query_id
FROM SNOWFLAKE.ACCOUNT_USAGE.TASK_HISTORY h
WHERE h.database_name ILIKE 'USER$%'
  AND h.scheduled_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
ORDER BY h.scheduled_time DESC;`,
      },
      {
        id: 'automation-cost',
        title: 'Cost per automation',
        description: 'Task compute plus the agent credits of runs started by an automation (trigger_type = \'automation\').',
        source: 'core',
        sql: `WITH task_compute AS (
  SELECT database_name, schema_name, task_name, SUM(credits_used) AS task_credits
  FROM SNOWFLAKE.ACCOUNT_USAGE.SERVERLESS_TASK_HISTORY
  WHERE database_name ILIKE 'USER$%' AND start_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
  GROUP BY 1, 2, 3
), agent_runs AS (
  SELECT user_name, agent_database_name || '.' || agent_schema_name || '.' || agent_name AS agent,
         COUNT(*) AS automated_turns,
         SUM(token_credits + COALESCE(metadata:ai_functions_credits::FLOAT, 0) + COALESCE(metadata:sql_query_credits::FLOAT, 0)) AS agent_credits
  FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY
  WHERE metadata:trigger_type::STRING = 'automation' AND start_time >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
  GROUP BY 1, 2
)
SELECT t.task_database, t.task_name, t.comment AS title,
       REGEXP_SUBSTR(t.definition, 'CORTEX_DATA_AGENT_RUN(_V2)?\\\\(\\\\s*''([^'']+)''', 1, 1, 'ie', 2) AS target_agent,
       c.task_credits, a.automated_turns, a.agent_credits
FROM SNOWFLAKE.ACCOUNT_USAGE.TASKS t
LEFT JOIN task_compute c ON c.database_name = t.task_database AND c.schema_name = t.task_schema AND c.task_name = t.task_name
LEFT JOIN agent_runs a ON a.user_name = REGEXP_REPLACE(t.task_database, '^USER\\\\$', '') AND UPPER(a.agent) = UPPER(target_agent)
WHERE t.deleted IS NULL AND t.task_database ILIKE 'USER$%'
ORDER BY t.task_database, t.task_name;
-- If one user schedules the same agent twice, agent credits are shared between the two rows; the mart splits them per run.`,
      },
      {
        id: 'mart-automations',
        title: 'Automations from the mart',
        description: 'One row per automation (incl. deleted) with health, runs and cost; V_AUTOMATION_RUN has one row per run.',
        source: 'mart',
        sql: `SELECT kind, owner_user, title, target_agent, state, schedule, health, runs, failed, success_rate,
       ROUND(total_credits, 4) AS credits, last_run, last_error
FROM AGENT_OBS.MART.V_AUTOMATION
ORDER BY owner_user, title;

SELECT title, scheduled_time, state, duration_ms, task_credits, agent_credits, code_credits, thread_id
FROM AGENT_OBS.MART.V_AUTOMATION_RUN
ORDER BY scheduled_time DESC;`,
      },
    ],
  },

  // ------------------------------------------------------------------ Agent detail
  {
    id: 'agent',
    title: 'Agent detail',
    intro: [
      'One agent: its configuration (model, budget, tools, capabilities, owner, versions), KPIs, daily usage with config-change markers, tool usage, planning depth and top users.',
    ],
    queries: [
      {
        id: 'describe-agent',
        title: 'Agent configuration',
        description: 'Live spec. Replace the name; DESCRIBE needs USAGE or MONITOR on the agent.',
        source: 'core',
        sql: `SHOW AGENTS IN ACCOUNT;
DESCRIBE AGENT MY_DB.MY_SCHEMA.MY_AGENT;
-- Tools and their resources are in the agent_spec column (JSON):
SELECT t.value:tool_spec:name::STRING AS tool, t.value:tool_spec:type::STRING AS type
FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) d, LATERAL FLATTEN(TRY_PARSE_JSON(d."agent_spec"):tools) t;`,
      },
      {
        id: 'agent-events-udtf',
        title: 'All events for one agent (no account-level access needed)',
        description: 'With MONITOR on the agent you can read its events through this function instead of the whole event table.',
        source: 'core',
        sql: `SELECT timestamp, record_type, record:name::STRING AS name, trace:trace_id::STRING AS trace_id
FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_OBSERVABILITY_EVENTS(
       SPLIT_PART($agent, '.', 1), SPLIT_PART($agent, '.', 2), SPLIT_PART($agent, '.', 3), 'CORTEX AGENT'))
WHERE timestamp >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
ORDER BY timestamp DESC
LIMIT 200;`,
      },
      {
        id: 'agent-tool-usage',
        title: 'Tool calls by tool for one agent',
        description: 'Tool spans carry the tool name in the span name or in sql_execution.analyst_tool_name.',
        source: 'core',
        sql: `SELECT COALESCE(record_attributes:"snow.ai.observability.agent.tool.sql_execution.analyst_tool_name"::STRING,
                REGEXP_SUBSTR(record:name::STRING, '^[A-Za-z]+Tool[A-Za-z]*_(.*)$', 1, 1, 'e', 1),
                record:name::STRING) AS tool,
       COUNT(*) AS calls,
       ROUND(AVG(DATEDIFF(millisecond, start_timestamp, timestamp))) AS avg_ms,
       COUNT_IF(record:status:code::STRING = 'STATUS_CODE_ERROR') AS errors
FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS
WHERE record_type = 'SPAN'
  AND record:name::STRING ILIKE '%Tool%'
  AND record_attributes:"snow.ai.observability.database.name"::STRING || '.' ||
      record_attributes:"snow.ai.observability.schema.name"::STRING   || '.' ||
      record_attributes:"snow.ai.observability.object.name"::STRING = $agent
  AND timestamp >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
GROUP BY 1
ORDER BY calls DESC;`,
      },
      {
        id: 'mart-agent',
        title: 'Agent detail from the mart',
        description: 'Config history is SCD2: one row per configuration version.',
        source: 'mart',
        sql: `SELECT * FROM AGENT_OBS.MART.V_AGENT_CONFIG WHERE agent_fqn = '"' || REPLACE($agent, '.', '"."') || '"';
SELECT * FROM AGENT_OBS.MART.AGG_TOOL_DAILY WHERE agent_fqn = '"' || REPLACE($agent, '.', '"."') || '"' ORDER BY day DESC;
SELECT * FROM AGENT_OBS.MART.V_AGENT_CONFIG_CHANGES WHERE agent_fqn = '"' || REPLACE($agent, '.', '"."') || '"' ORDER BY changed_at DESC;`,
      },
    ],
  },

  // ------------------------------------------------------------------ Threads & traces
  {
    id: 'threads',
    title: 'Threads & traces',
    intro: [
      'Forensics. Search threads by id, request id, user or question text. Open one for the full transcript and, per turn, the span waterfall, the SQL that ran (with warehouse metrics from QUERY_HISTORY) and authoritative cost.',
      'A turn’s spans share TRACE:trace_id in the event table. The root span (AgentV2RequestResponseInfo) holds the question, response and status; planning, tool and SQL spans hold tool inputs and outputs. Thread id 0 means “no thread” (an API call without one).',
    ],
    queries: [
      {
        id: 'trace-spans',
        title: 'Span waterfall for one trace',
        description: 'Replace the trace id (from the root span or the Threads page).',
        source: 'core',
        sql: `SET trace_id = '<trace id>';
SELECT record:name::STRING AS span_name, trace:span_id::STRING AS span_id, record:parent_span_id::STRING AS parent_span_id,
       start_timestamp, timestamp AS end_timestamp, DATEDIFF(millisecond, start_timestamp, timestamp) AS duration_ms,
       record:status:code::STRING AS status,
       record_attributes:"snow.ai.observability.agent.planning.model"::STRING AS model,
       record_attributes:"snow.ai.observability.agent.tool.sql_execution.query_id"::STRING AS query_id
FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS
WHERE trace:trace_id::STRING = $trace_id AND record_type = 'SPAN'
ORDER BY start_timestamp;`,
      },
      {
        id: 'thread-transcript',
        title: 'Transcript for one thread',
        description: 'Question and answer per turn. Content: needs READ UNREDACTED AI OBSERVABILITY EVENTS TABLE.',
        source: 'core',
        sql: `SET thread_id = '<thread id>';
SELECT timestamp,
       record_attributes:"ai.observability.record_root.input"::STRING  AS question,
       record_attributes:"snow.ai.observability.agent.response"::STRING AS response,
       record_attributes:"snow.ai.observability.agent.status.code"::STRING AS status_code
FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS
WHERE record:name::STRING = 'AgentV2RequestResponseInfo'
  AND record_attributes:"snow.ai.observability.agent.thread_id"::STRING = $thread_id
ORDER BY timestamp;`,
      },
      {
        id: 'agent-sql-with-warehouse',
        title: 'Agent-generated SQL with warehouse metrics',
        description: 'Joins each SQL span to QUERY_HISTORY by query id.',
        source: 'core',
        sql: `SELECT e.timestamp, e.record_attributes:"snow.ai.observability.object.name"::STRING AS agent_name,
       e.record_attributes:"snow.ai.observability.agent.tool.sql_execution.verified_query_used"::BOOLEAN AS verified_query_used,
       q.query_id, q.warehouse_name, q.warehouse_size, q.execution_status, q.total_elapsed_time, q.bytes_scanned, q.error_message,
       e.record_attributes:"snow.ai.observability.agent.tool.sql_execution.query"::STRING AS sql_text
FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS e
JOIN SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY q
  ON q.query_id = e.record_attributes:"snow.ai.observability.agent.tool.sql_execution.query_id"::STRING
WHERE e.record_type = 'SPAN'
  AND e.timestamp >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
  AND q.start_time >= DATEADD(day, -$days - 1, CURRENT_TIMESTAMP())
ORDER BY e.timestamp DESC
LIMIT 200;`,
      },
      {
        id: 'mart-threads',
        title: 'Threads, turns and spans from the mart',
        description: 'The same joins, precomputed, with full history.',
        source: 'mart',
        sql: `SELECT * FROM AGENT_OBS.MART.V_THREAD WHERE thread_id = '<thread id>';
SELECT * FROM AGENT_OBS.MART.V_TURN   WHERE thread_id = '<thread id>' ORDER BY turn_number;
SELECT * FROM AGENT_OBS.MART.V_SPAN   WHERE trace_id  = '<trace id>'  ORDER BY start_ts_utc;
SELECT * FROM AGENT_OBS.MART.V_SQL_EXECUTION WHERE trace_id = '<trace id>';`,
      },
    ],
  },

  // ------------------------------------------------------------------ Config
  {
    id: 'config',
    title: 'Config',
    intro: [
      'Every agent from SHOW AGENTS and DESCRIBE AGENT, with governance flags. The pipeline snapshots each agent’s spec hourly, and a change creates a new SCD2 version, so the change log shows what changed and when.',
      'An agent is only visible to the pipeline if its role has USAGE or MONITOR on it. "Not visible" counts agents that SHOW AGENTS lists but DESCRIBE can’t read.',
    ],
    definitions: [
      ['Unbounded budget', 'No orchestration budget (seconds or tokens) set in the spec.'],
      ['Owner ACCOUNTADMIN', 'Agent owned by ACCOUNTADMIN. Usually better owned by a dedicated role.'],
      ['No sample questions', 'Spec has no sample questions, so users get no starter prompts.'],
    ],
    queries: [
      {
        id: 'show-agents',
        title: 'All agents in the account',
        description: 'Owner, comment and creation time for every agent you can see.',
        source: 'core',
        sql: `SHOW AGENTS IN ACCOUNT;
SELECT "database_name", "schema_name", "name", "owner", "comment", "created_on"
FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
ORDER BY 1, 2, 3;`,
      },
      {
        id: 'mart-config',
        title: 'Configuration catalog from the mart',
        description: 'Current config plus governance flags; V_AGENT_CONFIG_CHANGES is the change log.',
        source: 'mart',
        sql: `SELECT agent_fqn, owner, orchestration_model, tool_count, has_web_search, has_code_execution,
       gov_owner_accountadmin, gov_no_description, gov_no_sample_questions, gov_unbounded_budget, gov_not_visible_to_ingest
FROM AGENT_OBS.MART.V_AGENT_CONFIG
ORDER BY agent_fqn;`,
      },
    ],
  },

  // ------------------------------------------------------------------ Assets
  {
    id: 'assets',
    title: 'Assets',
    intro: [
      'Semantic views and Cortex Search services: which agents are configured to use each one ("bound") versus which ones traces show actually being used. "Bound but unused" points to dead configuration. "Bound but missing" means the asset was dropped or isn’t visible, so the agent will fail when it tries to use it.',
    ],
    queries: [
      {
        id: 'assets-used',
        title: 'Semantic views and search services actually used',
        description: 'Resource names from Cortex Analyst, semantic-context and Cortex Search spans.',
        source: 'core',
        sql: `SELECT COALESCE(record_attributes:"snow.ai.observability.agent.tool.cortex_analyst.semantic_model",
                record_attributes:"snow.ai.observability.agent.tool.semantic_context.semantic_model",
                record_attributes:"snow.ai.observability.agent.tool.cortex_search.name")::STRING AS asset,
       record_attributes:"snow.ai.observability.object.name"::STRING AS agent_name,
       COUNT(*) AS calls, MAX(timestamp) AS last_used
FROM SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS
WHERE record_type = 'SPAN' AND asset IS NOT NULL
  AND timestamp >= DATEADD(day, -$days, CURRENT_TIMESTAMP())
GROUP BY 1, 2
ORDER BY calls DESC;`,
      },
      {
        id: 'assets-inventory',
        title: 'Semantic view and search service inventory',
        description: 'Everything that could be bound to an agent.',
        source: 'core',
        sql: `SHOW SEMANTIC VIEWS IN ACCOUNT;
SHOW CORTEX SEARCH SERVICES IN ACCOUNT;`,
      },
      {
        id: 'mart-assets',
        title: 'Asset catalog from the mart',
        description: 'Bound vs used, with flags.',
        source: 'mart',
        sql: `SELECT asset_key, asset_type, agents_bound, agents_using, calls, users, vq_hit_rate,
       is_shared, is_bound_unused, is_bound_but_missing
FROM AGENT_OBS.MART.V_ASSET_CATALOG_30D
ORDER BY calls DESC;`,
      },
    ],
  },

  // ------------------------------------------------------------------ Admin & lineage
  {
    id: 'admin',
    title: 'Admin, pipeline & lineage',
    intro: [
      'Admin shows your role and content tier, data freshness for each source, and recent pipeline runs. The pipeline is a serverless task graph, AGENT_OBS.ADMIN.T_AGENT_OBS_ROOT, on cron 0 */12 * * * UTC. It loads each source incrementally, refreshes the dynamic tables, then classifies new questions.',
      'Snowflake lineage records how every mart object is built, so you can trace any view in the app back to the Snowflake source it came from.',
    ],
    queries: [
      {
        id: 'lineage-upstream',
        title: 'Where does a mart view come from?',
        description: 'Upstream lineage of the turn view, back to SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS. Swap in any MART view.',
        source: 'mart',
        sql: `SELECT distance,
       source_object_domain, source_object_database || '.' || source_object_schema || '.' || source_object_name AS source,
       target_object_database || '.' || target_object_schema || '.' || target_object_name AS target
FROM TABLE(SNOWFLAKE.CORE.GET_LINEAGE('AGENT_OBS.MART.V_TURN', 'TABLE', 'UPSTREAM', 5))
WHERE source_object_database || '.' || source_object_schema || '.' || source_object_name
   <> target_object_database || '.' || target_object_schema || '.' || target_object_name
ORDER BY distance, source;`,
      },
      {
        id: 'lineage-downstream',
        title: 'What depends on the event table?',
        description: 'Everything in this account built from the AI observability event table.',
        source: 'core',
        sql: `SELECT distance, target_object_domain,
       target_object_database || '.' || target_object_schema || '.' || target_object_name AS target
FROM TABLE(SNOWFLAKE.CORE.GET_LINEAGE('SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS', 'TABLE', 'DOWNSTREAM', 3))
ORDER BY distance, target;`,
      },
      {
        id: 'pipeline-runs',
        title: 'Pipeline runs and task state',
        description: 'Each load step logs rows changed and status; task history shows each scheduled run.',
        source: 'mart',
        sql: `SELECT step, status, started_at, ended_at, rows_inserted, rows_updated, message
FROM AGENT_OBS.MART.V_PIPELINE_RUNS
ORDER BY started_at DESC;

SHOW TASKS IN SCHEMA AGENT_OBS.ADMIN;`,
      },
    ],
  },
];
