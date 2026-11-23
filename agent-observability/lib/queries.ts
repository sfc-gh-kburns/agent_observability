/**
 * Named queries against AGENT_OBS.MART (the only schema this app reads).
 * Every query runs with caller's rights (see app/api/q/[name]/route.ts), so
 * the CORE masking policies decide whether content columns come back.
 * User-supplied values are always bound (`?`), never interpolated.
 */

export type Params = {
  days: number;
  agent: string | null;
  thread: string | null;
  trace: string | null;
  request: string | null;
  q: string | null;
  /** Optional UTC window (ISO) — used to slice a trace id shared by several turns. */
  from: string | null;
  to: string | null;
  failed: boolean;
  limit: number;
  /** Question theme id (Conversation trends drill-down). */
  theme: string | null;
  /** End user name (End users drill-down). */
  user: string | null;
  /** 'all' includes service/app and system accounts; default is people only. */
  kind: string | null;
};

type Built = { sql: string; binds: (string | number | null)[] };
type QueryDef = (p: Params) => Built;

const M = 'AGENT_OBS.MART';

/** `AND (? IS NULL OR col = ?)` — optional equality filter. */
const optEq = (col: string, v: string | null) => ({
  clause: `AND (?::STRING IS NULL OR ${col} = ?::STRING)`,
  binds: [v, v],
});

const kpiSelect = `
  SUM(TURNS) AS TURNS,
  HLL_ESTIMATE(HLL_COMBINE(HLL_IMPORT(THREADS_HLL))) AS THREADS,
  HLL_ESTIMATE(HLL_COMBINE(HLL_IMPORT(USERS_HLL))) AS USERS,
  SUM(COMBINED_CREDITS) AS CREDITS,
  SUM(TOKENS) AS TOKENS,
  DIV0NULL(SUM(SUCCESS_TURNS), SUM(TURNS)) AS SUCCESS_RATE,
  DIV0NULL(SUM(SQL_ERRORS), SUM(SQL_CALLS)) AS SQL_ERROR_RATE,
  APPROX_PERCENTILE_ESTIMATE(APPROX_PERCENTILE_COMBINE(DURATION_TDIGEST), 0.5) AS P50_MS,
  APPROX_PERCENTILE_ESTIMATE(APPROX_PERCENTILE_COMBINE(DURATION_TDIGEST), 0.95) AS P95_MS,
  DIV0NULL(SUM(TOKENS_CACHE_READ), SUM(TOKENS_INPUT) + SUM(TOKENS_CACHE_READ) + SUM(TOKENS_CACHE_WRITE)) AS CACHE_SHARE`;

export const QUERIES: Record<string, QueryDef> = {
  whoami: () => ({
    sql: `SELECT CURRENT_USER() AS USER_NAME, CURRENT_ROLE() AS ROLE_NAME, ${M}.CAN_VIEW_CONTENT() AS CAN_VIEW_CONTENT`,
    binds: [],
  }),

  // ---------------- Portfolio ----------------
  kpis: (p) => {
    const a = optEq('AGENT_FQN', p.agent);
    return {
      sql: `SELECT IFF(DAY > DATEADD(day, -?, CURRENT_DATE()), 'cur', 'prev') AS PERIOD, ${kpiSelect}
            FROM ${M}.AGG_AGENT_DAILY
            WHERE DAY > DATEADD(day, -2 * ?, CURRENT_DATE()) ${a.clause}
            GROUP BY 1`,
      binds: [p.days, p.days, ...a.binds],
    };
  },
  feedback_kpis: (p) => {
    const a = optEq('AGENT_FQN', p.agent);
    return {
      sql: `SELECT SUM(FEEDBACK_COUNT) AS N, SUM(POSITIVE) AS POSITIVE, SUM(NEGATIVE) AS NEGATIVE
            FROM ${M}.AGG_FEEDBACK_DAILY WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) ${a.clause}`,
      binds: [p.days, ...a.binds],
    };
  },
  trend: (p) => {
    const a = optEq('AGENT_FQN', p.agent);
    return {
      sql: `SELECT DAY, INTERFACE, SUM(TURNS) AS TURNS, SUM(COMBINED_CREDITS) AS CREDITS
            FROM ${M}.AGG_AGENT_DAILY WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) ${a.clause}
            GROUP BY 1, 2 ORDER BY 1`,
      binds: [p.days, ...a.binds],
    };
  },
  leaderboard: (p) => ({
    sql: `WITH c AS (
            SELECT AGENT_FQN, ${kpiSelect}, MAX(LAST_TURN_AT_UTC) AS LAST_USED_UTC
            FROM ${M}.AGG_AGENT_DAILY WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) GROUP BY 1
          ), f AS (
            SELECT AGENT_FQN, DIV0NULL(SUM(POSITIVE), SUM(FEEDBACK_COUNT)) AS FEEDBACK_POSITIVE_RATE, SUM(FEEDBACK_COUNT) AS FEEDBACK_COUNT
            FROM ${M}.AGG_FEEDBACK_DAILY WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) GROUP BY 1
          ), s AS (
            SELECT AGENT_FQN, ARRAY_AGG(OBJECT_CONSTRUCT('d', DAY, 't', T)) WITHIN GROUP (ORDER BY DAY) AS SPARK
            FROM (SELECT AGENT_FQN, DAY, SUM(TURNS) T FROM ${M}.AGG_AGENT_DAILY
                  WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) GROUP BY 1, 2) GROUP BY 1
          )
          SELECT COALESCE(l.AGENT_FQN, c.AGENT_FQN) AS AGENT_FQN, COALESCE(l.DISPLAY_NAME, c.AGENT_FQN) AS DISPLAY_NAME,
                 l.OWNER, c.TURNS, c.USERS, c.CREDITS, DIV0NULL(c.CREDITS, c.TURNS) AS CREDITS_PER_TURN,
                 c.SUCCESS_RATE, c.SQL_ERROR_RATE, c.P95_MS, f.FEEDBACK_POSITIVE_RATE, f.FEEDBACK_COUNT,
                 COALESCE(c.LAST_USED_UTC, l.LAST_USED_UTC) AS LAST_USED_UTC, s.SPARK::VARIANT AS SPARK,
                 COALESCE(c.TURNS, 0) = 0 AS FLAG_IDLE, l.FLAG_COST_OUTLIER, l.FLAG_QUALITY_REGRESSION
          FROM ${M}.V_AGENT_LEADERBOARD_30D l
          FULL OUTER JOIN c ON c.AGENT_FQN = l.AGENT_FQN
          LEFT JOIN f ON f.AGENT_FQN = COALESCE(l.AGENT_FQN, c.AGENT_FQN)
          LEFT JOIN s ON s.AGENT_FQN = COALESCE(l.AGENT_FQN, c.AGENT_FQN)
          ORDER BY COALESCE(c.TURNS, 0) DESC, DISPLAY_NAME`,
    binds: [p.days, p.days, p.days],
  }),
  interface_mix: (p) => {
    const a = optEq('AGENT_FQN', p.agent);
    return {
      sql: `SELECT INTERFACE, SUM(TURNS) AS TURNS, SUM(COMBINED_CREDITS) AS CREDITS
            FROM ${M}.AGG_AGENT_DAILY WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) ${a.clause}
            GROUP BY 1 ORDER BY 2 DESC`,
      binds: [p.days, ...a.binds],
    };
  },
  model_mix: (p) => {
    const a = optEq('AGENT_FQN', p.agent);
    return {
      sql: `SELECT MODEL, SERVICE_TYPE, SUM(CREDITS) AS CREDITS, SUM(TOKENS_TOTAL) AS TOKENS, SUM(TURNS) AS TURNS,
                   DIV0NULL(SUM(TOKENS_CACHE_READ), SUM(TOKENS_INPUT) + SUM(TOKENS_CACHE_READ) + SUM(TOKENS_CACHE_WRITE)) AS CACHE_SHARE
            FROM ${M}.AGG_MODEL_DAILY WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) ${a.clause}
            GROUP BY 1, 2 ORDER BY 3 DESC`,
      binds: [p.days, ...a.binds],
    };
  },
  funnel: () => ({ sql: `SELECT * FROM ${M}.V_ADOPTION_FUNNEL_30D`, binds: [] }),

  // ---------------- AI spend + Cortex Code (account-wide, not agent-filtered) ----------------
  ai_spend_trend: (p) => ({
    sql: `SELECT DAY, PRODUCT, SUM(CREDITS) AS CREDITS, SUM(REQUESTS) AS REQUESTS
          FROM ${M}.V_AI_SPEND_DAILY WHERE DAY > DATEADD(day, -?, CURRENT_DATE())
          GROUP BY 1, 2 ORDER BY 1`,
    binds: [p.days],
  }),
  ai_spend_by_product: (p) => ({
    sql: `SELECT PRODUCT,
                 SUM(IFF(DAY > DATEADD(day, -?, CURRENT_DATE()), CREDITS, 0)) AS CREDITS,
                 SUM(IFF(DAY > DATEADD(day, -?, CURRENT_DATE()), REQUESTS, 0)) AS REQUESTS,
                 SUM(IFF(DAY <= DATEADD(day, -?, CURRENT_DATE()), CREDITS, 0)) AS PREV_CREDITS
          FROM ${M}.V_AI_SPEND_DAILY WHERE DAY > DATEADD(day, -2 * ?, CURRENT_DATE())
          GROUP BY 1 ORDER BY 2 DESC`,
    binds: [p.days, p.days, p.days, p.days],
  }),
  code_by_surface: (p) => ({
    sql: `SELECT SURFACE, SUM(REQUESTS) AS REQUESTS, SUM(THREADS) AS THREADS, COUNT(DISTINCT USER_ID) AS USERS,
                 SUM(CREDITS) AS CREDITS, SUM(TOKENS) AS TOKENS, DIV0NULL(SUM(CREDITS), SUM(REQUESTS)) AS CREDITS_PER_REQUEST
          FROM ${M}.V_CODE_USAGE_DAILY WHERE DAY > DATEADD(day, -?, CURRENT_DATE())
          GROUP BY 1 ORDER BY 5 DESC`,
    binds: [p.days],
  }),
  code_models: (p) => ({
    sql: `SELECT MODEL, SUM(CREDITS) AS CREDITS, SUM(TOKENS) AS TOKENS, SUM(REQUESTS) AS REQUESTS
          FROM ${M}.V_CODE_MODEL_DAILY WHERE DAY > DATEADD(day, -?, CURRENT_DATE())
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    binds: [p.days],
  }),
  code_top_users: (p) => ({
    sql: `SELECT USER_NAME, SUM(REQUESTS) AS REQUESTS, SUM(CREDITS) AS CREDITS,
                 ARRAY_UNIQUE_AGG(SURFACE)::VARIANT AS SURFACES, MAX(DAY) AS LAST_ACTIVE
          FROM ${M}.V_CODE_USAGE_DAILY WHERE DAY > DATEADD(day, -?, CURRENT_DATE())
          GROUP BY 1 ORDER BY 3 DESC LIMIT 15`,
    binds: [p.days],
  }),

  // ---------------- Agent detail ----------------
  agent: (p) => ({
    sql: `SELECT AGENT_FQN, DISPLAY_NAME, OWNER, COMMENT, CREATED_ON, DEFAULT_VERSION_NAME, VERSION_COUNT, ORCHESTRATION_MODEL,
                 BUDGET_SECONDS, BUDGET_TOKENS, TOOL_COUNT, ANALYST_TOOL_COUNT, SEARCH_TOOL_COUNT, CUSTOM_TOOL_COUNT,
                 HAS_WEB_SEARCH, HAS_CODE_EXECUTION, HAS_CHARTS, HAS_MCP, HAS_MEMORY, HAS_ANALYTICAL_SEARCH, SKILL_COUNT,
                 SAMPLE_QUESTION_COUNT, IS_DROPPED, GOV_NO_DESCRIPTION, GOV_NO_SAMPLE_QUESTIONS,
                 AGENT_SPEC:instructions::VARIANT AS INSTRUCTIONS
          FROM ${M}.V_AGENT_CONFIG WHERE AGENT_FQN = ?`,
    binds: [p.agent],
  }),
  agent_tools: (p) => ({
    sql: `SELECT TOOL_NAME, TOOL_TYPE, TOOL_DESCRIPTION, RESOURCE_TYPE, RESOURCE_FQN, WAREHOUSE
          FROM ${M}.V_AGENT_TOOL WHERE IS_CURRENT AND AGENT_FQN = ? ORDER BY TOOL_INDEX`,
    binds: [p.agent],
  }),
  tool_usage: (p) => {
    const a = optEq('AGENT_FQN', p.agent);
    return {
      sql: `SELECT SPAN_CATEGORY, TOOL_NAME, SUM(CALLS) AS CALLS, SUM(TURNS) AS TURNS, SUM(ERRORS) AS ERRORS,
                   DIV0NULL(SUM(SUM_DURATION_MS), SUM(CALLS)) AS AVG_MS,
                   APPROX_PERCENTILE_ESTIMATE(APPROX_PERCENTILE_COMBINE(DURATION_TDIGEST), 0.95) AS P95_MS
            FROM ${M}.AGG_TOOL_DAILY WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) ${a.clause}
            GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 50`,
      binds: [p.days, ...a.binds],
    };
  },
  planning_depth: (p) => {
    const a = optEq('AGENT_FQN', p.agent);
    return {
      sql: `SELECT LEAST(PLANNING_STEPS, 10) AS STEPS, SUM(TURNS) AS TURNS
            FROM ${M}.AGG_PLANNING_DEPTH WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) ${a.clause}
            GROUP BY 1 ORDER BY 1`,
      binds: [p.days, ...a.binds],
    };
  },
  top_users: (p) => {
    const a = optEq('AGENT_FQN', p.agent);
    return {
      sql: `SELECT USER_NAME, COUNT(*) AS TURNS, COUNT(DISTINCT THREAD_ID) AS THREADS, SUM(COMBINED_CREDITS) AS CREDITS,
                   COUNT(DISTINCT AGENT_FQN) AS AGENTS, MAX(END_TIME_UTC) AS LAST_ACTIVE_UTC
            FROM ${M}.V_TURN WHERE START_TIME_UTC > DATEADD(day, -?, CURRENT_DATE()) ${a.clause}
            GROUP BY 1 ORDER BY 2 DESC LIMIT 25`,
      binds: [p.days, ...a.binds],
    };
  },
  config_history: (p) => ({
    sql: `SELECT CHANGED_AT, IS_FIRST_SEEN, IS_DROPPED, ORCHESTRATION_MODEL, PREV_ORCHESTRATION_MODEL,
                 TOOL_COUNT, PREV_TOOL_COUNT, OWNER, PREV_OWNER, DEFAULT_VERSION_NAME, PREV_DEFAULT_VERSION_NAME,
                 AGENT_SPEC, PREV_AGENT_SPEC
          FROM ${M}.V_AGENT_CONFIG_CHANGES WHERE AGENT_FQN = ? ORDER BY CHANGED_AT DESC`,
    binds: [p.agent],
  }),

  // ---------------- Conversation trends ----------------
  // Every trend query excludes system-generated and test prompts (IS_NOISE).
  trend_themes: (p) => {
    const a = optEq('AGENT_KEY', p.agent);
    return {
      sql: `WITH t AS (
              SELECT * FROM ${M}.V_QUESTION_TURN
              WHERE START_TIME_UTC > DATEADD(day, -?, CURRENT_DATE()) AND NOT IS_NOISE AND THEME_ID IS NOT NULL ${a.clause}
            ), per_user AS (
              SELECT AGENT_KEY, THEME_ID, MAX(N) AS MAX_ASKS_ONE_USER
              FROM (SELECT AGENT_KEY, THEME_ID, USER_ID, COUNT(*) N FROM t GROUP BY 1, 2, 3) GROUP BY 1, 2
            ), weekly AS (
              SELECT AGENT_KEY, THEME_ID, ARRAY_AGG(N) WITHIN GROUP (ORDER BY WK) AS SPARK
              FROM (SELECT AGENT_KEY, THEME_ID, DATE_TRUNC('week', DAY) WK, COUNT(*) N FROM t GROUP BY 1, 2, 3) GROUP BY 1, 2
            ), g AS (
              SELECT AGENT_KEY, THEME_ID,
                     ANY_VALUE(AGENT_DISPLAY_NAME) AS AGENT_DISPLAY_NAME,
                     ANY_VALUE(THEME_LABEL) AS THEME_LABEL, ANY_VALUE(THEME_TOPIC) AS THEME_TOPIC,
                     MODE(INTENT) AS INTENT, MODE(DOMAIN) AS DOMAIN,
                     COUNT(*) AS ASKS, COUNT(DISTINCT QUESTION_HASH) AS PHRASINGS,
                     COUNT(DISTINCT USER_ID) AS USERS, COUNT(DISTINCT THREAD_ID) AS THREADS,
                     COUNT(DISTINCT DATE_TRUNC('week', DAY)) AS ACTIVE_WEEKS,
                     MIN(START_TIME_UTC) AS FIRST_ASKED_UTC, MAX(START_TIME_UTC) AS LAST_ASKED_UTC,
                     COUNT_IF(DAY > DATEADD(day, -7, CURRENT_DATE())) AS ASKS_LAST_7D,
                     COUNT_IF(DAY <= DATEADD(day, -7, CURRENT_DATE()) AND DAY > DATEADD(day, -14, CURRENT_DATE())) AS ASKS_PRIOR_7D,
                     DIV0NULL(COUNT_IF(IS_SUCCESS), COUNT(*)) AS SUCCESS_RATE,
                     COUNT_IF(SQL_CALLS > 0) AS SQL_TURNS,
                     DIV0NULL(COUNT_IF(VERIFIED_QUERY_HITS > 0), COUNT_IF(SQL_CALLS > 0)) AS VQ_HIT_RATE,
                     DIV0NULL(SUM(SQL_ERRORS), SUM(SQL_CALLS)) AS SQL_ERROR_RATE,
                     MEDIAN(DURATION_MS) AS P50_MS, SUM(COMBINED_CREDITS) AS CREDITS,
                     SUM(FEEDBACK_POSITIVE) AS FEEDBACK_POSITIVE, SUM(FEEDBACK_NEGATIVE) AS FEEDBACK_NEGATIVE,
                     ARRAY_UNIQUE_AGG(m.VALUE::STRING) AS METRICS
              FROM t, LATERAL FLATTEN(INPUT => COALESCE(t.METRICS, ARRAY_CONSTRUCT(NULL)), OUTER => TRUE) m
              GROUP BY 1, 2
            )
            SELECT g.* EXCLUDE (METRICS), g.METRICS::VARIANT AS METRICS, w.SPARK::VARIANT AS SPARK, u.MAX_ASKS_ONE_USER,
                   -- Opportunity flags (thresholds documented in the page legend)
                   (g.ASKS >= 3 AND g.SQL_TURNS >= 2 AND COALESCE(g.VQ_HIT_RATE, 0) < 0.5
                    AND g.INTENT IN ('metric_lookup','breakdown','ranking','trend','comparison','list_records')) AS FLAG_VQR,
                   (g.ASKS >= 3 AND (g.ACTIVE_WEEKS >= 2 OR u.MAX_ASKS_ONE_USER >= 3)
                    AND g.INTENT IN ('metric_lookup','breakdown','ranking','trend','comparison','report_build')) AS FLAG_REPORT,
                   (g.INTENT = 'problem_report'
                    OR (g.ASKS >= 2 AND (g.SUCCESS_RATE < 0.8 OR COALESCE(g.SQL_ERROR_RATE, 0) > 0.25 OR g.FEEDBACK_NEGATIVE > 0))) AS FLAG_GAP,
                   (g.ASKS >= 2 AND g.INTENT IN ('data_discovery','definition_help')) AS FLAG_ONBOARDING,
                   (g.ASKS_LAST_7D >= 3 AND g.ASKS_LAST_7D >= 2 * g.ASKS_PRIOR_7D) AS FLAG_RISING,
                   g.ASKS + 2 * g.USERS + 2 * g.ACTIVE_WEEKS AS PRIORITY
            FROM g
            LEFT JOIN weekly w ON w.AGENT_KEY = g.AGENT_KEY AND w.THEME_ID = g.THEME_ID
            LEFT JOIN per_user u ON u.AGENT_KEY = g.AGENT_KEY AND u.THEME_ID = g.THEME_ID
            ORDER BY PRIORITY DESC, ASKS DESC LIMIT 500`,
      binds: [p.days, ...a.binds],
    };
  },
  trend_summary: (p) => {
    const a = optEq('AGENT_KEY', p.agent);
    return {
      sql: `SELECT COUNT_IF(NOT IS_NOISE) AS QUESTIONS, COUNT_IF(IS_NOISE) AS NOISE,
                   COUNT(DISTINCT IFF(NOT IS_NOISE, USER_ID, NULL)) AS ASKERS,
                   COUNT(DISTINCT IFF(NOT IS_NOISE, AGENT_KEY || '|' || THEME_ID, NULL)) AS THEMES,
                   COUNT_IF(INTENT = 'followup_refinement') AS FOLLOWUPS,
                   DIV0NULL(COUNT_IF(NOT IS_NOISE AND IS_SUCCESS), COUNT_IF(NOT IS_NOISE)) AS SUCCESS_RATE,
                   (SELECT QUESTIONS_CLASSIFIED FROM ${M}.V_QUESTION_ENRICHMENT_STATUS) AS CLASSIFIED,
                   (SELECT MODEL FROM ${M}.V_QUESTION_ENRICHMENT_STATUS) AS MODEL,
                   (SELECT LAST_CLASSIFIED_AT FROM ${M}.V_QUESTION_ENRICHMENT_STATUS) AS LAST_CLASSIFIED_AT
            FROM ${M}.V_QUESTION_TURN WHERE START_TIME_UTC > DATEADD(day, -?, CURRENT_DATE()) ${a.clause}`,
      binds: [p.days, ...a.binds],
    };
  },
  trend_intents: (p) => {
    const a = optEq('AGENT_KEY', p.agent);
    return {
      sql: `SELECT INTENT, COUNT(*) AS ASKS, COUNT(DISTINCT USER_ID) AS USERS, DIV0NULL(COUNT_IF(IS_SUCCESS), COUNT(*)) AS SUCCESS_RATE
            FROM ${M}.V_QUESTION_TURN WHERE START_TIME_UTC > DATEADD(day, -?, CURRENT_DATE()) AND NOT IS_NOISE ${a.clause}
            GROUP BY 1 ORDER BY 2 DESC`,
      binds: [p.days, ...a.binds],
    };
  },
  trend_domains: (p) => {
    const a = optEq('AGENT_KEY', p.agent);
    return {
      sql: `SELECT DOMAIN, COUNT(*) AS ASKS FROM ${M}.V_QUESTION_TURN
            WHERE START_TIME_UTC > DATEADD(day, -?, CURRENT_DATE()) AND NOT IS_NOISE ${a.clause}
            GROUP BY 1 ORDER BY 2 DESC`,
      binds: [p.days, ...a.binds],
    };
  },
  trend_intent_weekly: (p) => {
    const a = optEq('AGENT_KEY', p.agent);
    return {
      sql: `SELECT DATE_TRUNC('week', DAY) AS DAY, INTENT, COUNT(*) AS ASKS FROM ${M}.V_QUESTION_TURN
            WHERE START_TIME_UTC > DATEADD(day, -?, CURRENT_DATE()) AND NOT IS_NOISE ${a.clause}
            GROUP BY 1, 2 ORDER BY 1`,
      binds: [p.days, ...a.binds],
    };
  },
  trend_terms: (p) => {
    const a = optEq('AGENT_KEY', p.agent);
    return {
      sql: `WITH t AS (SELECT * FROM ${M}.V_QUESTION_TURN
                       WHERE START_TIME_UTC > DATEADD(day, -?, CURRENT_DATE()) AND NOT IS_NOISE ${a.clause})
            SELECT KIND, TERM, COUNT(*) AS ASKS, COUNT(DISTINCT AGENT_KEY) AS AGENTS,
                   DIV0NULL(COUNT_IF(VERIFIED_QUERY_HITS > 0), COUNT_IF(SQL_CALLS > 0)) AS VQ_HIT_RATE
            FROM (SELECT 'metric' AS KIND, LOWER(TRIM(f.VALUE::STRING)) AS TERM, t.* FROM t, LATERAL FLATTEN(INPUT => t.METRICS) f
                  UNION ALL
                  SELECT 'dimension', LOWER(TRIM(f.VALUE::STRING)), t.* FROM t, LATERAL FLATTEN(INPUT => t.DIMENSIONS) f)
            WHERE TERM <> ''
            GROUP BY 1, 2 QUALIFY ROW_NUMBER() OVER (PARTITION BY KIND ORDER BY COUNT(*) DESC) <= 15
            ORDER BY 1, 3 DESC`,
      binds: [p.days, ...a.binds],
    };
  },
  trend_theme_phrasings: (p) => ({
    sql: `SELECT USER_QUESTION, COUNT(*) AS ASKS, COUNT(DISTINCT USER_ID) AS USERS, MAX(START_TIME_UTC) AS LAST_ASKED_UTC,
                 DIV0NULL(COUNT_IF(IS_SUCCESS), COUNT(*)) AS SUCCESS_RATE, MAX_BY(THREAD_ID, START_TIME_UTC) AS LAST_THREAD_ID,
                 ANY_VALUE(TIME_WINDOW) AS TIME_WINDOW
          FROM ${M}.V_QUESTION_TURN
          WHERE AGENT_KEY = ? AND THEME_ID = ? AND START_TIME_UTC > DATEADD(day, -?, CURRENT_DATE())
          GROUP BY 1 ORDER BY 2 DESC, 4 DESC LIMIT 50`,
    binds: [p.agent, p.theme, p.days],
  }),
  // Best SQL answer for a theme: latest successful execution, preferring ones that already used a verified query.
  trend_theme_sql: (p) => ({
    sql: `SELECT q.USER_QUESTION, q.THREAD_ID, q.START_TIME_UTC, s.SEMANTIC_MODEL, s.TOOL_NAME, s.VERIFIED_QUERY_USED, s.FINAL_SQL
          FROM ${M}.V_QUESTION_TURN q
          JOIN ${M}.V_SQL_EXECUTION s ON s.TRACE_ID = q.TRACE_ID   -- SQL spans carry the trace id, not the request id
          WHERE q.AGENT_KEY = ? AND q.THEME_ID = ? AND q.IS_SUCCESS AND NOT q.IS_SHARED_TRACE AND NOT s.IS_ERROR AND s.FINAL_SQL IS NOT NULL
          ORDER BY s.VERIFIED_QUERY_USED DESC, q.START_TIME_UTC DESC LIMIT 3`,
    binds: [p.agent, p.theme],
  }),

  // ---------------- End users ----------------
  // V_END_USER_TURN rows; `kind` = 'person' (default) hides service/app and system accounts.
  eu_summary: (p) => {
    const a = optEq('AGENT_KEY', p.agent);
    return {
      sql: `WITH t AS (
              SELECT *, IFF(DAY > DATEADD(day, -?, CURRENT_DATE()), 'cur', 'prev') AS PERIOD
              FROM ${M}.V_END_USER_TURN
              WHERE DAY > DATEADD(day, -2 * ?, CURRENT_DATE()) AND (? = 'all' OR ACCOUNT_KIND = 'person') ${a.clause}
            )
            SELECT PERIOD, COUNT(DISTINCT USER_NAME) AS USERS,
                   COUNT(DISTINCT IFF(FIRST_SEEN_UTC > DATEADD(day, -?, CURRENT_DATE()), USER_NAME, NULL)) AS NEW_USERS,
                   COUNT(*) AS TURNS, COUNT(DISTINCT THREAD_ID) AS THREADS, SUM(COMBINED_CREDITS) AS CREDITS,
                   COUNT(ISSUE_REASON) AS ISSUES, COUNT(DISTINCT IFF(ISSUE_REASON IS NOT NULL, USER_NAME, NULL)) AS USERS_WITH_ISSUES,
                   SUM(FEEDBACK_POSITIVE) AS FEEDBACK_POSITIVE, SUM(FEEDBACK_NEGATIVE) AS FEEDBACK_NEGATIVE,
                   MEDIAN(DURATION_MS) AS P50_MS
            FROM t GROUP BY 1`,
      binds: [p.days, p.days, p.kind, ...a.binds, p.days],
    };
  },
  eu_weekly: (p) => {
    const a = optEq('AGENT_KEY', p.agent);
    return {
      sql: `SELECT DATE_TRUNC('week', DAY) AS DAY,
                   COUNT(DISTINCT IFF(DATE_TRUNC('week', FIRST_SEEN_UTC) = DATE_TRUNC('week', DAY), USER_NAME, NULL)) AS NEW_USERS,
                   COUNT(DISTINCT IFF(DATE_TRUNC('week', FIRST_SEEN_UTC) < DATE_TRUNC('week', DAY), USER_NAME, NULL)) AS RETURNING_USERS,
                   COUNT(*) AS TURNS, SUM(COMBINED_CREDITS) AS CREDITS, COUNT(ISSUE_REASON) AS ISSUES
            FROM ${M}.V_END_USER_TURN
            WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) AND (? = 'all' OR ACCOUNT_KIND = 'person') ${a.clause}
            GROUP BY 1 ORDER BY 1`,
      binds: [p.days, p.kind, ...a.binds],
    };
  },
  // One row per user with activity, cost, issues, feedback, favourite agent/theme and segment flags.
  eu_users: (p) => {
    const a = optEq('AGENT_KEY', p.agent);
    const u = optEq('USER_NAME', p.user);
    return {
      sql: `WITH t AS (
              SELECT * FROM ${M}.V_END_USER_TURN
              WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) AND (? = 'all' OR ACCOUNT_KIND = 'person') ${a.clause} ${u.clause}
            ), top_agent AS (
              SELECT USER_NAME, AGENT_DISPLAY_NAME AS TOP_AGENT, AGENT_KEY AS TOP_AGENT_KEY FROM t
              GROUP BY 1, 2, 3 QUALIFY ROW_NUMBER() OVER (PARTITION BY USER_NAME ORDER BY COUNT(*) DESC) = 1
            ), top_theme AS (
              SELECT USER_NAME, THEME_LABEL AS TOP_THEME, INTENT AS TOP_THEME_INTENT, COUNT(*) AS TOP_THEME_ASKS FROM t
              WHERE THEME_ID IS NOT NULL AND NOT IS_NOISE
              GROUP BY 1, THEME_ID, 2, 3 QUALIFY ROW_NUMBER() OVER (PARTITION BY USER_NAME ORDER BY COUNT(*) DESC) = 1
            ), weekly AS (
              SELECT USER_NAME, ARRAY_AGG(N) WITHIN GROUP (ORDER BY WK) AS SPARK
              FROM (SELECT USER_NAME, DATE_TRUNC('week', DAY) WK, COUNT(*) N FROM t GROUP BY 1, 2) GROUP BY 1
            ), g AS (
              SELECT USER_NAME, ANY_VALUE(USER_DISPLAY_NAME) AS DISPLAY_NAME, ANY_VALUE(ACCOUNT_KIND) AS ACCOUNT_KIND,
                     ANY_VALUE(USER_TYPE) AS USER_TYPE, MIN(FIRST_SEEN_UTC) AS FIRST_SEEN_UTC,
                     COUNT(*) AS TURNS, COUNT(DISTINCT THREAD_ID) AS THREADS, COUNT(DISTINCT DAY) AS ACTIVE_DAYS,
                     COUNT(DISTINCT AGENT_KEY) AS AGENTS, COUNT(DISTINCT IFF(NOT IS_NOISE, THEME_ID, NULL)) AS THEMES,
                     SUM(COMBINED_CREDITS) AS CREDITS, DIV0NULL(SUM(COMBINED_CREDITS), COUNT(*)) AS CREDITS_PER_TURN,
                     COUNT(ISSUE_REASON) AS ISSUES, DIV0NULL(COUNT(ISSUE_REASON), COUNT(*)) AS ISSUE_RATE,
                     SUM(FEEDBACK_POSITIVE) AS FEEDBACK_POSITIVE, SUM(FEEDBACK_NEGATIVE) AS FEEDBACK_NEGATIVE,
                     MEDIAN(DURATION_MS) AS P50_MS, MAX(START_TIME_UTC) AS LAST_SEEN_UTC,
                     DIV0NULL(COUNT_IF(INTENT IN ('data_discovery','definition_help')), COUNT(*)) AS DISCOVERY_SHARE
              FROM t GROUP BY 1
            )
            SELECT g.*, ta.TOP_AGENT, ta.TOP_AGENT_KEY, tt.TOP_THEME, tt.TOP_THEME_INTENT, tt.TOP_THEME_ASKS, w.SPARK::VARIANT AS SPARK,
                   (g.TURNS >= 20 AND g.ACTIVE_DAYS >= 5)                                      AS FLAG_POWER,
                   (g.ISSUES >= 2 AND (g.ISSUE_RATE >= 0.2 OR g.FEEDBACK_NEGATIVE > 0))        AS FLAG_STRUGGLING,
                   (g.FIRST_SEEN_UTC > DATEADD(day, -?, CURRENT_DATE()))                        AS FLAG_NEW,
                   (g.LAST_SEEN_UTC < DATEADD(day, -14, CURRENT_DATE()))                        AS FLAG_DORMANT,
                   (g.TURNS >= 3 AND g.DISCOVERY_SHARE >= 0.3)                                   AS FLAG_NEEDS_ONBOARDING
            FROM g
            LEFT JOIN top_agent ta ON ta.USER_NAME = g.USER_NAME
            LEFT JOIN top_theme tt ON tt.USER_NAME = g.USER_NAME
            LEFT JOIN weekly w ON w.USER_NAME = g.USER_NAME
            ORDER BY g.TURNS DESC LIMIT 500`,
      binds: [p.days, p.kind, ...a.binds, ...u.binds, p.days],
    };
  },
  // Same person asking the same theme on several days: a personal dashboard or scheduled report would answer it.
  eu_dashboard_opps: (p) => {
    const a = optEq('AGENT_KEY', p.agent);
    const u = optEq('USER_NAME', p.user);
    return {
      sql: `SELECT USER_NAME, AGENT_KEY, ANY_VALUE(AGENT_DISPLAY_NAME) AS AGENT_DISPLAY_NAME, THEME_ID,
                   ANY_VALUE(THEME_LABEL) AS THEME_LABEL, MODE(INTENT) AS INTENT, MODE(DOMAIN) AS DOMAIN,
                   COUNT(*) AS ASKS, COUNT(DISTINCT DAY) AS DAYS_ASKED, COUNT(DISTINCT DATE_TRUNC('week', DAY)) AS WEEKS_ASKED,
                   SUM(COMBINED_CREDITS) AS CREDITS, MEDIAN(DURATION_MS) AS P50_MS,
                   MIN(START_TIME_UTC) AS FIRST_ASKED_UTC, MAX(START_TIME_UTC) AS LAST_ASKED_UTC,
                   MAX_BY(THREAD_ID, START_TIME_UTC) AS LAST_THREAD_ID
            FROM ${M}.V_END_USER_TURN
            WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) AND (? = 'all' OR ACCOUNT_KIND = 'person') ${a.clause} ${u.clause}
              AND THEME_ID IS NOT NULL AND NOT IS_NOISE
              AND INTENT IN ('metric_lookup','breakdown','ranking','trend','comparison','list_records','report_build')
            GROUP BY USER_NAME, AGENT_KEY, THEME_ID
            HAVING COUNT(*) >= 3 AND COUNT(DISTINCT DAY) >= 2
            ORDER BY DAYS_ASKED DESC, ASKS DESC LIMIT 100`,
      binds: [p.days, p.kind, ...a.binds, ...u.binds],
    };
  },
  eu_issue_reasons: (p) => {
    const a = optEq('AGENT_KEY', p.agent);
    return {
      sql: `SELECT ISSUE_REASON, COUNT(*) AS TURNS, COUNT(DISTINCT USER_NAME) AS USERS
            FROM ${M}.V_END_USER_TURN
            WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) AND (? = 'all' OR ACCOUNT_KIND = 'person') ${a.clause} AND ISSUE_REASON IS NOT NULL
            GROUP BY 1 ORDER BY 2 DESC`,
      binds: [p.days, p.kind, ...a.binds],
    };
  },
  eu_issues: (p) => {
    const a = optEq('AGENT_KEY', p.agent);
    const u = optEq('USER_NAME', p.user);
    return {
      sql: `SELECT START_TIME_UTC, USER_NAME, AGENT_KEY, AGENT_DISPLAY_NAME, THREAD_ID, TURN_ID, ISSUE_REASON,
                   COALESCE(USER_QUESTION, LEFT(QUESTION, 300)) AS QUESTION, THEME_LABEL, SQL_ERRORS, SQL_CALLS, STATUS_CODE
            FROM ${M}.V_END_USER_TURN
            WHERE DAY > DATEADD(day, -?, CURRENT_DATE()) AND (? = 'all' OR ACCOUNT_KIND = 'person') ${a.clause} ${u.clause}
              AND ISSUE_REASON IS NOT NULL
            ORDER BY START_TIME_UTC DESC LIMIT 100`,
      binds: [p.days, p.kind, ...a.binds, ...u.binds],
    };
  },
  eu_feedback: (p) => {
    const a = optEq('COALESCE(t.AGENT_FQN, t.NO_AGENT_LABEL)', p.agent);
    const u = optEq('f.USER_NAME', p.user);
    return {
      sql: `SELECT f.FEEDBACK_TS_UTC, f.USER_NAME, f.IS_POSITIVE, f.FEEDBACK_TEXT, f.THREAD_ID, f.TURN_ID,
                   COALESCE(t.AGENT_DISPLAY_NAME, f.AGENT_NAME) AS AGENT_DISPLAY_NAME, LEFT(t.QUESTION, 300) AS QUESTION
            FROM ${M}.V_FEEDBACK f LEFT JOIN ${M}.V_TURN t ON t.TURN_ID = f.TURN_ID
            WHERE f.FEEDBACK_TS_UTC > DATEADD(day, -?, CURRENT_DATE()) ${a.clause} ${u.clause}
            ORDER BY f.FEEDBACK_TS_UTC DESC LIMIT 100`,
      binds: [p.days, ...a.binds, ...u.binds],
    };
  },
  eu_user_agents: (p) => ({
    sql: `SELECT AGENT_KEY, ANY_VALUE(AGENT_DISPLAY_NAME) AS AGENT_DISPLAY_NAME, COUNT(*) AS TURNS, COUNT(DISTINCT THREAD_ID) AS THREADS,
                 SUM(COMBINED_CREDITS) AS CREDITS, COUNT(ISSUE_REASON) AS ISSUES, MAX(START_TIME_UTC) AS LAST_USED_UTC
          FROM ${M}.V_END_USER_TURN WHERE USER_NAME = ? AND DAY > DATEADD(day, -?, CURRENT_DATE())
          GROUP BY 1 ORDER BY 3 DESC`,
    binds: [p.user, p.days],
  }),
  eu_user_themes: (p) => ({
    sql: `SELECT AGENT_KEY, ANY_VALUE(AGENT_DISPLAY_NAME) AS AGENT_DISPLAY_NAME, THEME_ID, ANY_VALUE(THEME_LABEL) AS THEME_LABEL,
                 MODE(INTENT) AS INTENT, MODE(DOMAIN) AS DOMAIN, COUNT(*) AS ASKS, COUNT(DISTINCT DAY) AS DAYS_ASKED,
                 SUM(COMBINED_CREDITS) AS CREDITS, COUNT(ISSUE_REASON) AS ISSUES, MAX(START_TIME_UTC) AS LAST_ASKED_UTC
          FROM ${M}.V_END_USER_TURN
          WHERE USER_NAME = ? AND DAY > DATEADD(day, -?, CURRENT_DATE()) AND THEME_ID IS NOT NULL AND NOT IS_NOISE
          GROUP BY AGENT_KEY, THEME_ID ORDER BY ASKS DESC LIMIT 50`,
    binds: [p.user, p.days],
  }),
  eu_user_intents: (p) => ({
    sql: `SELECT INTENT, COUNT(*) AS ASKS FROM ${M}.V_END_USER_TURN
          WHERE USER_NAME = ? AND DAY > DATEADD(day, -?, CURRENT_DATE()) AND INTENT IS NOT NULL AND NOT IS_NOISE
          GROUP BY 1 ORDER BY 2 DESC`,
    binds: [p.user, p.days],
  }),
  eu_user_daily: (p) => ({
    sql: `SELECT DAY, COUNT(*) AS TURNS, SUM(COMBINED_CREDITS) AS CREDITS, COUNT(ISSUE_REASON) AS ISSUES
          FROM ${M}.V_END_USER_TURN WHERE USER_NAME = ? AND DAY > DATEADD(day, -?, CURRENT_DATE())
          GROUP BY 1 ORDER BY 1`,
    binds: [p.user, p.days],
  }),
  eu_user_turns: (p) => ({
    sql: `SELECT START_TIME_UTC, AGENT_DISPLAY_NAME, AGENT_KEY, THREAD_ID, TURN_ID, COALESCE(USER_QUESTION, LEFT(QUESTION, 300)) AS QUESTION,
                 INTENT, THEME_LABEL, COMBINED_CREDITS, DURATION_MS, ISSUE_REASON, FEEDBACK_POSITIVE, FEEDBACK_NEGATIVE
          FROM ${M}.V_END_USER_TURN WHERE USER_NAME = ? AND DAY > DATEADD(day, -?, CURRENT_DATE())
          ORDER BY START_TIME_UTC DESC LIMIT 50`,
    binds: [p.user, p.days],
  }),

  // ---------------- Turns / threads / traces ----------------
  turns: (p) => {
    const a = optEq('AGENT_FQN', p.agent);
    const like = p.q ? `%${p.q}%` : null;
    return {
      sql: `SELECT TURN_ID, REQUEST_ID, TRACE_ID, THREAD_ID, TURN_NUMBER, START_TIME_UTC, AGENT_FQN, AGENT_DISPLAY_NAME,
                   USER_NAME, INTERFACE, AGENT_VERSION_NAME, QUESTION, IS_SUCCESS, STATUS_CODE, SQL_ERRORS, SQL_CALLS,
                   COMBINED_CREDITS, TOKENS, DURATION_MS, PLANNING_STEPS, TOOL_CALLS
            FROM ${M}.V_TURN
            WHERE START_TIME_UTC > DATEADD(day, -?, CURRENT_DATE()) ${a.clause}
              AND (?::BOOLEAN = FALSE OR NOT IS_SUCCESS OR SQL_ERRORS > 0)
              AND (?::STRING IS NULL OR QUESTION ILIKE ? OR USER_NAME ILIKE ? OR REQUEST_ID = ? OR THREAD_ID = ?)
            ORDER BY START_TIME_UTC DESC LIMIT ?`,
      binds: [p.days, ...a.binds, p.failed ? 1 : 0, like, like, like, p.q, p.q, p.limit],
    };
  },
  expensive_turns: (p) => {
    const a = optEq('AGENT_FQN', p.agent);
    return {
      sql: `SELECT TURN_ID, THREAD_ID, START_TIME_UTC, AGENT_DISPLAY_NAME, AGENT_FQN, USER_NAME, QUESTION,
                   COMBINED_CREDITS, TOKENS, DURATION_MS
            FROM ${M}.V_TURN WHERE START_TIME_UTC > DATEADD(day, -?, CURRENT_DATE()) ${a.clause}
            ORDER BY COMBINED_CREDITS DESC NULLS LAST LIMIT 10`,
      binds: [p.days, ...a.binds],
    };
  },
  threads: (p) => {
    const a = optEq('FIRST_AGENT_FQN', p.agent);
    const like = p.q ? `%${p.q}%` : null;
    return {
      sql: `SELECT THREAD_ID, THREAD_ID_SOURCE, FIRST_QUESTION, FIRST_AGENT_FQN, AGENT_DISPLAY_NAME, USER_NAME, INTERFACE,
                   TURNS, AGENT_VERSIONS::VARIANT AS AGENT_VERSIONS, IS_MULTI_VERSION, LAST_UPDATED_UTC, COMBINED_CREDITS, FAILED_TURNS,
                   SQL_ERRORS, FEEDBACK_POSITIVE, FEEDBACK_NEGATIVE
            FROM ${M}.V_THREAD
            WHERE LAST_UPDATED_UTC > DATEADD(day, -?, CURRENT_DATE()) ${a.clause}
              AND (?::BOOLEAN = FALSE OR FAILED_TURNS > 0 OR SQL_ERRORS > 0 OR FEEDBACK_NEGATIVE > 0)
              AND (?::STRING IS NULL OR THREAD_ID = ? OR FIRST_QUESTION ILIKE ? OR USER_NAME ILIKE ?
                   OR THREAD_ID IN (SELECT THREAD_ID FROM ${M}.V_TURN WHERE REQUEST_ID = ? OR QUESTION ILIKE ?))
            ORDER BY LAST_UPDATED_UTC DESC LIMIT ?`,
      binds: [p.days, ...a.binds, p.failed ? 1 : 0, p.q, p.q, like, like, p.q, like, p.limit],
    };
  },
  thread_turns: (p) => ({
    sql: `SELECT TURN_ID, REQUEST_ID, TRACE_ID, THREAD_ID, THREAD_ID_SOURCE, TURN_NUMBER, START_TIME_UTC, END_TIME_UTC,
                 AGENT_FQN, AGENT_DISPLAY_NAME, AGENT_VERSION_NAME, USER_NAME, ROLE_NAME, INTERFACE, COWORK_NAME,
                 QUESTION, RESPONSE, THINKING, SUGGESTED_QUERIES, STATUS_CODE, STATUS_DESCRIPTION, IS_SUCCESS,
                 TOKEN_CREDITS, AI_FUNCTIONS_CREDITS, SQL_QUERY_CREDITS, COMBINED_CREDITS, TOKENS, TOKENS_INPUT,
                 TOKENS_OUTPUT, TOKENS_CACHE_READ, TOKENS_CACHE_WRITE, TRACE_TOKENS_TOTAL, DURATION_MS, AGENT_DURATION_MS,
                 PLANNING_STEPS, TOOL_CALLS, SQL_CALLS, SQL_ERRORS, VERIFIED_QUERY_HITS, SEARCH_CALLS, PLANNING_MS,
                 TOOL_MS, RESPONSE_MS, HAS_USAGE, HAS_TRACE, IS_SHARED_TRACE, RESEARCH_MODE, INFERENCE_REGION
          FROM ${M}.V_TURN WHERE THREAD_ID = ? ORDER BY TURN_NUMBER`,
    binds: [p.thread],
  }),
  thread_feedback: (p) => ({
    sql: `SELECT TURN_ID, FEEDBACK_TS_UTC, USER_NAME, IS_POSITIVE, FEEDBACK_TEXT, TURN_MATCH
          FROM ${M}.V_FEEDBACK WHERE THREAD_ID = ? OR TURN_ID IN (SELECT TURN_ID FROM ${M}.V_TURN WHERE THREAD_ID = ?)`,
    binds: [p.thread, p.thread],
  }),
  trace_spans: (p) => ({
    sql: `SELECT EVENT_HASH, SPAN_ID, PARENT_SPAN_ID, SPAN_NAME, SPAN_CATEGORY, TOOL_NAME, RESOURCE_FQN, MODEL,
                 STEP_NUMBER, TOOL_SELECTED_NAME, TOOL_SELECTED_TYPE, START_TS_UTC, END_TS_UTC, DURATION_MS, OFFSET_MS,
                 DEPTH, IS_ORPHAN, SPAN_STATUS_CODE, TOOL_STATUS_CODE, IS_ERROR, IS_SQL_ERROR, VERIFIED_QUERY_USED,
                 QUERY_ID, TOKENS_INPUT, TOKENS_OUTPUT, TOKENS_CACHE_READ, TOKENS_CACHE_WRITE, TOKENS_TOTAL, ATTRS::VARIANT AS ATTRS
          FROM ${M}.V_SPAN WHERE TRACE_ID = ?
            AND (?::STRING IS NULL OR START_TS_UTC >= DATEADD(second, -1, TRY_TO_TIMESTAMP_NTZ(?)))
            AND (?::STRING IS NULL OR START_TS_UTC <= DATEADD(second, 1, TRY_TO_TIMESTAMP_NTZ(?)))
          ORDER BY START_TS_UTC, DEPTH, END_TS_UTC DESC`,
    binds: [p.trace, p.from, p.from, p.to, p.to],
  }),
  turn_cost: (p) => ({
    sql: `SELECT SERVICE_TYPE, MODEL, SUM(TOKENS_INPUT) AS TOKENS_INPUT, SUM(TOKENS_OUTPUT) AS TOKENS_OUTPUT,
                 SUM(TOKENS_CACHE_READ) AS TOKENS_CACHE_READ, SUM(TOKENS_CACHE_WRITE) AS TOKENS_CACHE_WRITE,
                 SUM(TOKENS_TOTAL) AS TOKENS_TOTAL, SUM(CREDITS_TOTAL) AS CREDITS, COUNT(*) AS STEPS
          FROM ${M}.V_TURN_MODEL_USAGE WHERE REQUEST_ID = ? GROUP BY 1, 2 ORDER BY CREDITS DESC`,
    binds: [p.request],
  }),
  trace_sql: (p) => ({
    sql: `SELECT SPAN_ID, TOOL_NAME, SEMANTIC_MODEL, QUERY_ID, WAREHOUSE, VERIFIED_QUERY_USED, IS_ERROR, HAS_VALIDATION_ISSUE,
                 STATUS_CODE, EXECUTION_STATUS, RESULT_ROWS, DURATION_MS, FINAL_SQL, VALIDATION_ERRORS::VARIANT AS VALIDATION_ERRORS, ERROR_CORRECTION,
                 QH_TOTAL_ELAPSED_MS, QH_BYTES_SCANNED, QH_WAREHOUSE_SIZE, QH_ERROR_MESSAGE
          FROM ${M}.V_SQL_EXECUTION WHERE TRACE_ID = ? ORDER BY START_TS_UTC`,
    binds: [p.trace],
  }),

  // ---------------- Config / assets / admin ----------------
  config_catalog: () => ({
    sql: `SELECT AGENT_FQN, DATABASE_NAME, SCHEMA_NAME, AGENT_NAME, DISPLAY_NAME, OWNER, COMMENT, CREATED_ON,
                 DEFAULT_VERSION_NAME, VERSION_COUNT, ORCHESTRATION_MODEL, BUDGET_SECONDS, BUDGET_TOKENS,
                 HAS_ANALYTICAL_SEARCH, TOOL_COUNT, ANALYST_TOOL_COUNT, SEARCH_TOOL_COUNT, CUSTOM_TOOL_COUNT,
                 HAS_WEB_SEARCH, HAS_CODE_EXECUTION, HAS_CHARTS, HAS_MCP, HAS_MEMORY, SKILL_COUNT, SAMPLE_QUESTION_COUNT,
                 BOUND_SEMANTIC_VIEWS::VARIANT AS BOUND_SEMANTIC_VIEWS, BOUND_SEARCH_SERVICES::VARIANT AS BOUND_SEARCH_SERVICES, BOUND_FUNCTIONS::VARIANT AS BOUND_FUNCTIONS, CONFIG_VERSIONS, LAST_CONFIG_CHANGE,
                 IS_DROPPED, GOV_WEB_SEARCH_ENABLED, GOV_CODE_EXECUTION_ENABLED, GOV_OWNER_ACCOUNTADMIN,
                 GOV_NO_DESCRIPTION, GOV_NO_SAMPLE_QUESTIONS, GOV_UNBOUNDED_BUDGET, GOV_NOT_VISIBLE_TO_INGEST
          FROM ${M}.V_AGENT_CONFIG ORDER BY DATABASE_NAME, SCHEMA_NAME, AGENT_NAME`,
    binds: [],
  }),
  config_changes: (p) => ({
    sql: `SELECT AGENT_FQN, CHANGED_AT, IS_FIRST_SEEN, IS_DROPPED, ORCHESTRATION_MODEL, PREV_ORCHESTRATION_MODEL,
                 TOOL_COUNT, PREV_TOOL_COUNT, OWNER, PREV_OWNER, DEFAULT_VERSION_NAME, PREV_DEFAULT_VERSION_NAME
          FROM ${M}.V_AGENT_CONFIG_CHANGES WHERE NOT IS_FIRST_SEEN OR IS_DROPPED ORDER BY CHANGED_AT DESC LIMIT ?`,
    binds: [p.limit],
  }),
  assets: () => ({
    sql: `SELECT ASSET_KEY, ASSET_TYPE, OWNER, COMMENT, VERIFIED_QUERY_COUNT, ASSET_DROPPED, AGENTS_BOUND, AGENTS_BOUND_LIST::VARIANT AS AGENTS_BOUND_LIST,
                 AGENTS_USING, AGENTS_USING_LIST::VARIANT AS AGENTS_USING_LIST, CALLS, TURNS, USERS, SQL_ERROR_RATE, VQ_HIT_RATE, P95_MS, IS_SHARED,
                 IS_BOUND_UNUSED, IS_BOUND_BUT_MISSING
          FROM ${M}.V_ASSET_CATALOG_30D
          ORDER BY CALLS DESC, AGENTS_BOUND DESC, ASSET_KEY`,
    binds: [],
  }),
  freshness: () => ({ sql: `SELECT * FROM ${M}.V_FRESHNESS`, binds: [] }),
  pipeline_runs: (p) => ({
    sql: `SELECT STEP, STATUS, STARTED_AT, ENDED_AT, DATEDIFF(second, STARTED_AT, ENDED_AT) AS SECONDS,
                 ROWS_INSERTED, ROWS_UPDATED, MESSAGE
          FROM ${M}.V_PIPELINE_RUNS ORDER BY STARTED_AT DESC LIMIT ?`,
    binds: [p.limit],
  }),
};

/** Parse and clamp query-string params (never trusted). */
export function parseParams(sp: URLSearchParams): Params {
  const int = (k: string, def: number, min: number, max: number) => {
    const n = Number.parseInt(sp.get(k) ?? '', 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const str = (k: string, max = 500) => {
    const v = sp.get(k)?.trim();
    return v ? v.slice(0, max) : null;
  };
  return {
    days: int('days', 30, 1, 730),
    agent: str('agent'),
    thread: str('thread'),
    trace: str('trace'),
    request: str('request'),
    q: str('q', 200),
    from: str('from', 40),
    to: str('to', 40),
    failed: sp.get('failed') === '1',
    limit: int('limit', 100, 1, 1000),
    theme: str('theme', 64),
    user: str('user', 256),
    kind: sp.get('kind') === 'all' ? 'all' : 'person',
  };
}

/** Queries whose results include content-tier columns (audited when visible). */
export const CONTENT_QUERIES = new Set([
  'thread_turns', 'trace_spans', 'trace_sql', 'thread_feedback', 'trend_theme_phrasings', 'trend_theme_sql',
  'eu_issues', 'eu_feedback', 'eu_user_turns',
]);
