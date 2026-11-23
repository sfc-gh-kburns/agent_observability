-- =====================================================================
-- 08_trends.sql — conversation trends: what users ask, per agent
--   RAW.QUESTION_ENRICHMENT   1 row per distinct question text (AI_COMPLETE
--                             structured classification + AI_EMBED vector).
--                             Incremental: a question is classified once.
--   CORE.QUESTION_CLUSTER     near-duplicate questions grouped into themes per
--                             agent (embedding similarity), rebuilt each run.
--   MART.V_QUESTION_TURN      turn-level join of themes to outcome signals.
-- Content tier: user_question, canonical_question, topic and theme labels are
-- derived from question text, so they carry the same masking as QUESTION.
-- Intent, domain, metrics and dimensions are generic metadata.
-- =====================================================================
USE ROLE AGENT_OBS_INGEST_ROLE;
USE WAREHOUSE AGENT_OBS_WH;
USE DATABASE AGENT_OBS;

MERGE INTO ADMIN.CONFIG t USING (SELECT * FROM VALUES
  ('CLASSIFIER_MODEL',      'claude-haiku-4-5',              'AI_COMPLETE model that classifies questions'),
  ('THEME_SIMILARITY',      '0.88',                          'Cosine similarity at which two canonical questions are the same theme'),
  ('CLASSIFY_BATCH_MAX',    '2000',                          'Max new distinct questions classified per pipeline run')
  AS s(KEY, VALUE, DESCRIPTION)) s ON t.KEY = s.KEY
WHEN NOT MATCHED THEN INSERT (KEY, VALUE, DESCRIPTION) VALUES (s.KEY, s.VALUE, s.DESCRIPTION);

CREATE TABLE IF NOT EXISTS RAW.QUESTION_ENRICHMENT (
  QUESTION_HASH STRING NOT NULL PRIMARY KEY,   -- SHA2 of the raw question text
  CLASSIFIER_VERSION STRING, MODEL STRING,
  USER_QUESTION STRING,                         -- content: question without app wrapper text
  CANONICAL_QUESTION STRING,                    -- content: generic form, specifics replaced by <placeholders>
  TOPIC STRING,                                 -- content: 2-4 word label
  INTENT STRING, DOMAIN STRING,
  METRICS ARRAY, DIMENSIONS ARRAY, TIME_WINDOW STRING,
  EMBEDDING VECTOR(FLOAT, 768),
  _ENRICHED_AT TIMESTAMP_LTZ);

CREATE TABLE IF NOT EXISTS CORE.QUESTION_CLUSTER (
  AGENT_KEY STRING, QUESTION_HASH STRING, THEME_ID STRING,
  THEME_LABEL STRING, THEME_TOPIC STRING,       -- content (from the theme's most-asked question)
  SIMILARITY FLOAT, _BUILT_AT TIMESTAMP_LTZ);

-- Bump when the prompt or schema changes; stale rows are re-classified.
CREATE OR REPLACE FUNCTION ADMIN.CLASSIFIER_VERSION() RETURNS STRING AS $$ 'v1' $$;

CREATE OR REPLACE FUNCTION ADMIN.CLASSIFY_PROMPT(AGENT STRING, QUESTION STRING) RETURNS STRING AS
$$
'You classify messages that business users send to a data analytics AI agent named ' || COALESCE(AGENT, 'unknown') || '.
Respond in JSON with these fields:
- user_question: the actual question or request the user wrote, without app/system wrapper text (e.g. "The user is viewing X", role context, pasted data, artifacts, instructions to the model). Max 300 characters.
- canonical_question: the question rewritten as a short generic question (max 15 words) that would read the same for anyone asking the same thing. Keep the metric names and grouping words literally (e.g. "revenue", "by region"). Replace only specific values - names, ids, places, products, numbers - with placeholders like <store>, <customer>, <product>, <N>. Leave out the time frame entirely (it is captured separately).
- topic: 2-4 word business topic label, e.g. "Revenue by category", "Stockout risk", "Agent capabilities".
- intent: one of metric_lookup (a single number), breakdown (a metric by a dimension), ranking (top/bottom N), trend (over time), comparison (period vs period or A vs B), diagnostic (why something happened, root cause), forecast_whatif, entity_lookup (details about one specific record), list_records, definition_help (what does X mean, how do I do X), data_discovery (what data or questions are available), report_build (dashboard, chart, report or export request), document_qa (policies, manuals, transcripts, documents), action_request (asks the agent to do or change something), followup_refinement (only makes sense with earlier context, e.g. "all time is fine"), problem_report (user says something is broken, blank or wrong), system_generated (machine-produced prompt such as an artifact refresh or eval harness), test_noise (tests, greetings, gibberish), other.
- domain: one of sales, finance, inventory_supply_chain, operations, customer, marketing, workforce, product, it_data_platform, support, other.
- metrics: business metrics referenced, lowercase and generic (e.g. ["revenue","units sold"]). Empty if none.
- dimensions: grouping or filter dimensions, lowercase and generic (e.g. ["product category","region"]). Empty if none.
- time_window: the requested time frame in generic words (e.g. "last month", "year to date", "last 90 days"), or "none".
<message>
' || LEFT(QUESTION, 2500) || '
</message>'
$$;

-- 1. Classify + embed new distinct questions --------------------------------
CREATE OR REPLACE PROCEDURE ADMIN.SP_ENRICH_QUESTIONS()
RETURNS VARIANT LANGUAGE SQL EXECUTE AS CALLER AS
$$
DECLARE
  run_id STRING DEFAULT UUID_STRING();
  started TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP();
  model STRING;
  batch_max INT;
  ins NUMBER DEFAULT 0;
BEGIN
  model := (SELECT AGENT_OBS.ADMIN.CFG('CLASSIFIER_MODEL'));
  batch_max := (SELECT AGENT_OBS.ADMIN.CFG('CLASSIFY_BATCH_MAX')::INT);

  -- Pending = question texts never classified, or classified by an older prompt version.
  CREATE OR REPLACE TEMPORARY TABLE _PENDING AS
    SELECT t.QUESTION_HASH, ANY_VALUE(t.QUESTION) AS QUESTION,
           MODE(COALESCE(t.AGENT_DISPLAY_NAME, t.AGENT_NAME)) AS AGENT, MAX(t.START_TIME_UTC) AS LAST_ASKED
    FROM AGENT_OBS.MART.V_TURN t
    WHERE NULLIF(TRIM(t.QUESTION), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM AGENT_OBS.RAW.QUESTION_ENRICHMENT e
                      WHERE e.QUESTION_HASH = t.QUESTION_HASH AND e.CLASSIFIER_VERSION = AGENT_OBS.ADMIN.CLASSIFIER_VERSION())
    GROUP BY 1
    ORDER BY LAST_ASKED DESC
    LIMIT :batch_max;

  CREATE OR REPLACE TEMPORARY TABLE _CLASSIFIED AS
    SELECT QUESTION_HASH,
           AI_COMPLETE(
             model => :model,
             prompt => AGENT_OBS.ADMIN.CLASSIFY_PROMPT(AGENT, QUESTION),
             model_parameters => {'temperature': 0},
             response_format => TYPE OBJECT(user_question STRING, canonical_question STRING, topic STRING,
                                            intent STRING, domain STRING, metrics ARRAY(STRING),
                                            dimensions ARRAY(STRING), time_window STRING)
           ) AS R
    FROM _PENDING;

  MERGE INTO AGENT_OBS.RAW.QUESTION_ENRICHMENT t USING (
    SELECT QUESTION_HASH,
           LEFT(R:user_question::STRING, 500) AS USER_QUESTION,
           LEFT(R:canonical_question::STRING, 300) AS CANONICAL_QUESTION,
           LEFT(R:topic::STRING, 80) AS TOPIC,
           LOWER(R:intent::STRING) AS INTENT, LOWER(R:domain::STRING) AS DOMAIN,
           R:metrics::ARRAY AS METRICS, R:dimensions::ARRAY AS DIMENSIONS,
           LOWER(R:time_window::STRING) AS TIME_WINDOW
    FROM _CLASSIFIED WHERE R IS NOT NULL
  ) s ON t.QUESTION_HASH = s.QUESTION_HASH
  WHEN MATCHED THEN UPDATE SET
    CLASSIFIER_VERSION = AGENT_OBS.ADMIN.CLASSIFIER_VERSION(), MODEL = :model,
    USER_QUESTION = s.USER_QUESTION, CANONICAL_QUESTION = s.CANONICAL_QUESTION, TOPIC = s.TOPIC,
    INTENT = s.INTENT, DOMAIN = s.DOMAIN, METRICS = s.METRICS, DIMENSIONS = s.DIMENSIONS,
    TIME_WINDOW = s.TIME_WINDOW, EMBEDDING = NULL, _ENRICHED_AT = CURRENT_TIMESTAMP()
  WHEN NOT MATCHED THEN INSERT
    (QUESTION_HASH, CLASSIFIER_VERSION, MODEL, USER_QUESTION, CANONICAL_QUESTION, TOPIC, INTENT, DOMAIN,
     METRICS, DIMENSIONS, TIME_WINDOW, EMBEDDING, _ENRICHED_AT)
  VALUES (s.QUESTION_HASH, AGENT_OBS.ADMIN.CLASSIFIER_VERSION(), :model, s.USER_QUESTION, s.CANONICAL_QUESTION,
          s.TOPIC, s.INTENT, s.DOMAIN, s.METRICS, s.DIMENSIONS, s.TIME_WINDOW, NULL, CURRENT_TIMESTAMP());
  ins := SQLROWCOUNT;

  -- Embed the generic form (topic adds context for very short questions). AI_EMBED needs a literal
  -- model name; it must match the VECTOR(FLOAT, 768) column.
  UPDATE AGENT_OBS.RAW.QUESTION_ENRICHMENT
     SET EMBEDDING = AI_EMBED('snowflake-arctic-embed-m-v1.5', COALESCE(CANONICAL_QUESTION, '') || ' | ' || COALESCE(TOPIC, ''))
   WHERE EMBEDDING IS NULL AND CANONICAL_QUESTION IS NOT NULL;

  CALL AGENT_OBS.ADMIN.SP_LOG(:run_id, 'ENRICH_QUESTIONS', :started, :ins, 0, NULL, 'OK', NULL);
  RETURN OBJECT_CONSTRUCT('step','ENRICH_QUESTIONS','classified',ins);
EXCEPTION WHEN OTHER THEN
  CALL AGENT_OBS.ADMIN.SP_LOG(:run_id, 'ENRICH_QUESTIONS', :started, 0, 0, NULL, 'FAILED', :SQLERRM);
  RAISE;
END;
$$;

-- 2. Group questions into themes per agent ----------------------------------
-- Leader clustering: each question joins the most-asked question in the same
-- agent whose canonical form is at least THEME_SIMILARITY similar (itself if
-- none is). A second hop resolves leaders that themselves follow a leader.
CREATE OR REPLACE PROCEDURE ADMIN.SP_CLUSTER_QUESTIONS()
RETURNS VARIANT LANGUAGE SQL EXECUTE AS CALLER AS
$$
DECLARE
  run_id STRING DEFAULT UUID_STRING();
  started TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP();
  thr FLOAT;
  n NUMBER DEFAULT 0;
BEGIN
  thr := (SELECT AGENT_OBS.ADMIN.CFG('THEME_SIMILARITY')::FLOAT);

  CREATE OR REPLACE TEMPORARY TABLE _Q AS
    SELECT COALESCE(t.AGENT_FQN, t.NO_AGENT_LABEL) AS AGENT_KEY, t.QUESTION_HASH,
           COUNT(*) AS ASKS, ANY_VALUE(e.EMBEDDING) AS EMBEDDING,
           ANY_VALUE(e.CANONICAL_QUESTION) AS CANONICAL_QUESTION, ANY_VALUE(e.TOPIC) AS TOPIC
    FROM AGENT_OBS.CORE.FACT_TURN t
    JOIN AGENT_OBS.RAW.QUESTION_ENRICHMENT e ON e.QUESTION_HASH = t.QUESTION_HASH
    WHERE e.EMBEDDING IS NOT NULL
      AND e.INTENT NOT IN ('system_generated', 'test_noise')
    GROUP BY 1, 2;

  CREATE OR REPLACE TEMPORARY TABLE _LEADER AS
    SELECT a.AGENT_KEY, a.QUESTION_HASH, b.QUESTION_HASH AS LEADER_HASH,
           VECTOR_COSINE_SIMILARITY(a.EMBEDDING, b.EMBEDDING) AS SIM
    FROM _Q a JOIN _Q b ON a.AGENT_KEY = b.AGENT_KEY
    WHERE a.QUESTION_HASH = b.QUESTION_HASH
       OR (VECTOR_COSINE_SIMILARITY(a.EMBEDDING, b.EMBEDDING) >= :thr
           AND (b.ASKS > a.ASKS OR (b.ASKS = a.ASKS AND b.QUESTION_HASH < a.QUESTION_HASH)))
    QUALIFY ROW_NUMBER() OVER (PARTITION BY a.AGENT_KEY, a.QUESTION_HASH
                               ORDER BY b.ASKS DESC, b.QUESTION_HASH) = 1;

  BEGIN TRANSACTION;
  -- TRUNCATE (not CREATE OR REPLACE) keeps the masking policies on the label columns.
  TRUNCATE TABLE AGENT_OBS.CORE.QUESTION_CLUSTER;
  INSERT INTO AGENT_OBS.CORE.QUESTION_CLUSTER
  SELECT l.AGENT_KEY, l.QUESTION_HASH, COALESCE(l2.LEADER_HASH, l.LEADER_HASH) AS THEME_ID,
         q.CANONICAL_QUESTION, q.TOPIC, l.SIM, CURRENT_TIMESTAMP()
  FROM _LEADER l
  LEFT JOIN _LEADER l2 ON l2.AGENT_KEY = l.AGENT_KEY AND l2.QUESTION_HASH = l.LEADER_HASH
  JOIN _Q q ON q.AGENT_KEY = l.AGENT_KEY AND q.QUESTION_HASH = COALESCE(l2.LEADER_HASH, l.LEADER_HASH);
  n := SQLROWCOUNT;
  COMMIT;

  CALL AGENT_OBS.ADMIN.SP_LOG(:run_id, 'CLUSTER_QUESTIONS', :started, :n, 0, NULL, 'OK', NULL);
  RETURN OBJECT_CONSTRUCT('step','CLUSTER_QUESTIONS','questions',n);
EXCEPTION WHEN OTHER THEN
  ROLLBACK;
  CALL AGENT_OBS.ADMIN.SP_LOG(:run_id, 'CLUSTER_QUESTIONS', :started, 0, 0, NULL, 'FAILED', :SQLERRM);
  RAISE;
END;
$$;

CREATE OR REPLACE PROCEDURE ADMIN.SP_REFRESH_TRENDS()
RETURNS VARIANT LANGUAGE SQL EXECUTE AS CALLER AS
$$
DECLARE a VARIANT; b VARIANT;
BEGIN
  CALL AGENT_OBS.ADMIN.SP_ENRICH_QUESTIONS();
  SELECT $1 INTO :a FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));
  CALL AGENT_OBS.ADMIN.SP_CLUSTER_QUESTIONS();
  SELECT $1 INTO :b FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));
  RETURN ARRAY_CONSTRUCT(a, b);
END;
$$;

-- Content masking on the derived text columns (idempotent) -----------------
EXECUTE IMMEDIATE $$
DECLARE
  c CURSOR FOR SELECT t, col FROM VALUES
    ('AGENT_OBS.RAW.QUESTION_ENRICHMENT', 'USER_QUESTION'),
    ('AGENT_OBS.RAW.QUESTION_ENRICHMENT', 'CANONICAL_QUESTION'),
    ('AGENT_OBS.RAW.QUESTION_ENRICHMENT', 'TOPIC'),
    ('AGENT_OBS.CORE.QUESTION_CLUSTER',   'THEME_LABEL'),
    ('AGENT_OBS.CORE.QUESTION_CLUSTER',   'THEME_TOPIC') AS v(t, col);
BEGIN
  FOR r IN c DO
    BEGIN
      EXECUTE IMMEDIATE 'ALTER TABLE ' || r.t || ' MODIFY COLUMN ' || r.col || ' UNSET MASKING POLICY';
    EXCEPTION WHEN OTHER THEN NULL;
    END;
    EXECUTE IMMEDIATE 'ALTER TABLE ' || r.t || ' MODIFY COLUMN ' || r.col || ' SET MASKING POLICY AGENT_OBS.ADMIN.MP_CONTENT_STRING';
  END FOR;
  RETURN 'trend content columns protected';
END;
$$;

-- MART: one row per turn that has a classified question ---------------------
CREATE OR REPLACE VIEW MART.V_QUESTION_TURN COMMENT = 'Turns joined to question classification, theme and outcome signals' AS
WITH fb AS (
  SELECT TURN_ID, COUNT_IF(IS_POSITIVE) AS FEEDBACK_POSITIVE, COUNT_IF(NOT IS_POSITIVE) AS FEEDBACK_NEGATIVE
  FROM AGENT_OBS.CORE.FACT_FEEDBACK WHERE TURN_ID IS NOT NULL GROUP BY 1
)
SELECT t.TURN_ID, t.REQUEST_ID, t.TRACE_ID, t.IS_SHARED_TRACE, t.THREAD_ID, t.TURN_NUMBER, t.START_TIME_UTC, TO_DATE(t.START_TIME_UTC) AS DAY,
       COALESCE(t.AGENT_FQN, t.NO_AGENT_LABEL) AS AGENT_KEY, t.AGENT_DISPLAY_NAME, t.INTERFACE,
       t.USER_ID, t.USER_NAME,
       e.QUESTION_HASH, e.USER_QUESTION, e.CANONICAL_QUESTION, e.TOPIC,
       e.INTENT, e.DOMAIN, e.METRICS, e.DIMENSIONS, e.TIME_WINDOW,
       e.INTENT IN ('system_generated', 'test_noise') AS IS_NOISE,
       c.THEME_ID, c.THEME_LABEL, c.THEME_TOPIC,
       t.IS_SUCCESS, t.SQL_CALLS, t.SQL_ERRORS, t.VERIFIED_QUERY_HITS, t.SEARCH_CALLS, t.TOOL_CALLS,
       t.DURATION_MS, t.COMBINED_CREDITS,
       COALESCE(f.FEEDBACK_POSITIVE, 0) AS FEEDBACK_POSITIVE, COALESCE(f.FEEDBACK_NEGATIVE, 0) AS FEEDBACK_NEGATIVE
FROM AGENT_OBS.MART.V_TURN t
JOIN AGENT_OBS.RAW.QUESTION_ENRICHMENT e ON e.QUESTION_HASH = t.QUESTION_HASH
LEFT JOIN AGENT_OBS.CORE.QUESTION_CLUSTER c
  ON c.AGENT_KEY = COALESCE(t.AGENT_FQN, t.NO_AGENT_LABEL) AND c.QUESTION_HASH = e.QUESTION_HASH
LEFT JOIN fb f ON f.TURN_ID = t.TURN_ID;

CREATE OR REPLACE VIEW MART.V_QUESTION_ENRICHMENT_STATUS AS
SELECT COUNT(*) AS QUESTIONS_CLASSIFIED, MAX(_ENRICHED_AT) AS LAST_CLASSIFIED_AT,
       ANY_VALUE(MODEL) AS MODEL, ANY_VALUE(CLASSIFIER_VERSION) AS CLASSIFIER_VERSION
FROM AGENT_OBS.RAW.QUESTION_ENRICHMENT;

-- ---------------------------------------------------------------------
-- End users: one row per turn with user profile, theme and issue signals
-- (backs the End users page). An "issue" is any turn with an SQL error, a
-- non-success status, negative feedback or a problem-report question.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW MART.V_END_USER_TURN COMMENT = 'Turn-level end-user activity with theme and issue signals' AS
WITH fb AS (
  SELECT TURN_ID, COUNT_IF(IS_POSITIVE) AS FEEDBACK_POSITIVE, COUNT_IF(NOT IS_POSITIVE) AS FEEDBACK_NEGATIVE
  FROM AGENT_OBS.CORE.FACT_FEEDBACK WHERE TURN_ID IS NOT NULL GROUP BY 1
), first_seen AS (
  SELECT USER_NAME, MIN(START_TIME_UTC) AS FIRST_SEEN_UTC FROM AGENT_OBS.CORE.FACT_TURN WHERE USER_NAME IS NOT NULL GROUP BY 1
)
SELECT t.TURN_ID, t.REQUEST_ID, t.TRACE_ID, t.THREAD_ID, t.START_TIME_UTC, TO_DATE(t.START_TIME_UTC) AS DAY,
       t.USER_ID, COALESCE(t.USER_NAME, u.USER_NAME, '(unknown)') AS USER_NAME,
       u.DISPLAY_NAME AS USER_DISPLAY_NAME, u.USER_TYPE,
       -- People vs apps/service principals vs Snowflake system processes. Apps that call an agent
       -- on behalf of their own end users show up as one service account.
       CASE WHEN COALESCE(t.USER_NAME, u.USER_NAME) = 'SYSTEM' THEN 'system'
            WHEN UPPER(COALESCE(u.USER_TYPE, '')) IN ('SERVICE', 'LEGACY_SERVICE', 'SNOWFLAKE_SERVICE')
              OR COALESCE(t.USER_NAME, u.USER_NAME) LIKE 'SF$SERVICE$%'
              OR COALESCE(t.USER_NAME, u.USER_NAME) LIKE 'MANAGED\\_SERVICE\\_%' ESCAPE '\\'
              OR REGEXP_LIKE(COALESCE(t.USER_NAME, u.USER_NAME), '.*(_SVC|_SVC_USER|_SERVICE|_APP|_API)$') THEN 'service'
            ELSE 'person' END AS ACCOUNT_KIND,
       CASE WHEN COALESCE(t.USER_NAME, u.USER_NAME) = 'SYSTEM' THEN TRUE
            WHEN UPPER(COALESCE(u.USER_TYPE, '')) IN ('SERVICE', 'LEGACY_SERVICE', 'SNOWFLAKE_SERVICE')
              OR COALESCE(t.USER_NAME, u.USER_NAME) LIKE 'SF$SERVICE$%'
              OR COALESCE(t.USER_NAME, u.USER_NAME) LIKE 'MANAGED\\_SERVICE\\_%' ESCAPE '\\'
              OR REGEXP_LIKE(COALESCE(t.USER_NAME, u.USER_NAME), '.*(_SVC|_SVC_USER|_SERVICE|_APP|_API)$') THEN TRUE
            ELSE FALSE END AS IS_SERVICE_USER,
       fs.FIRST_SEEN_UTC,
       COALESCE(t.AGENT_FQN, t.NO_AGENT_LABEL) AS AGENT_KEY, t.AGENT_DISPLAY_NAME, t.INTERFACE,
       t.QUESTION, q.USER_QUESTION, q.INTENT, q.DOMAIN, q.THEME_ID, q.THEME_LABEL, COALESCE(q.IS_NOISE, FALSE) AS IS_NOISE,
       t.IS_SUCCESS, t.STATUS_CODE, t.SQL_CALLS, t.SQL_ERRORS, t.VERIFIED_QUERY_HITS, t.DURATION_MS,
       t.COMBINED_CREDITS, t.TOKENS,
       COALESCE(f.FEEDBACK_POSITIVE, 0) AS FEEDBACK_POSITIVE, COALESCE(f.FEEDBACK_NEGATIVE, 0) AS FEEDBACK_NEGATIVE,
       CASE WHEN NOT t.IS_SUCCESS THEN 'Request failed'
            WHEN COALESCE(f.FEEDBACK_NEGATIVE, 0) > 0 THEN 'Negative feedback'
            WHEN t.SQL_ERRORS > 0 AND t.SQL_ERRORS = t.SQL_CALLS THEN 'All SQL attempts failed'
            WHEN t.SQL_ERRORS > 0 THEN 'SQL error (recovered)'
            WHEN q.INTENT = 'problem_report' THEN 'User reported a problem'
       END AS ISSUE_REASON
FROM AGENT_OBS.MART.V_TURN t
LEFT JOIN AGENT_OBS.CORE.DIM_USER u ON u.USER_ID = t.USER_ID
LEFT JOIN first_seen fs ON fs.USER_NAME = t.USER_NAME
LEFT JOIN AGENT_OBS.MART.V_QUESTION_TURN q ON q.TURN_ID = t.TURN_ID
LEFT JOIN fb f ON f.TURN_ID = t.TURN_ID;
