-- =====================================================================
-- 00_setup.sql  —  roles, warehouse, database, account-level grants
-- Run as the admin role from install.conf (default ACCOUNTADMIN). Idempotent.
-- =====================================================================
USE ROLE <% admin_role %>;

-- Roles ---------------------------------------------------------------
CREATE ROLE IF NOT EXISTS AGENT_OBS_INGEST_ROLE  COMMENT = 'Owns AGENT_OBS; runs ingestion tasks & dynamic tables';
CREATE ROLE IF NOT EXISTS AGENT_OBS_APP_ROLE     COMMENT = 'SAR app service role: read-only on AGENT_OBS.MART (metadata tier)';
CREATE ROLE IF NOT EXISTS AGENT_OBS_CONTENT_ROLE COMMENT = 'Content tier: unmasks questions/responses/SQL/feedback text in AGENT_OBS';

GRANT ROLE AGENT_OBS_APP_ROLE     TO ROLE SYSADMIN;
-- Content role is NOT granted to SYSADMIN: content access is opt-in per approved role/user
-- (e.g. GRANT ROLE AGENT_OBS_CONTENT_ROLE TO ROLE <approved_role>).
REVOKE ROLE AGENT_OBS_CONTENT_ROLE FROM ROLE SYSADMIN;
-- Ingest role sees content (needed for refresh/enrichment), so it is also kept out of the
-- SYSADMIN hierarchy; it is granted only to the pipeline operator below.
REVOKE ROLE AGENT_OBS_INGEST_ROLE FROM ROLE SYSADMIN;
-- Ingest role must see content to enrich it (themes in v0.2); it is not an end-user role.
GRANT ROLE AGENT_OBS_CONTENT_ROLE TO ROLE AGENT_OBS_INGEST_ROLE;
-- Let the setup user operate the pipeline.
SET setup_user = CURRENT_USER();
GRANT ROLE AGENT_OBS_INGEST_ROLE TO USER IDENTIFIER($setup_user);

-- Warehouse -----------------------------------------------------------
CREATE WAREHOUSE IF NOT EXISTS <% pipeline_warehouse %>
  WAREHOUSE_SIZE = <% pipeline_warehouse_size %> AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE
  COMMENT = 'AGENT_OBS ingestion + dynamic table refresh';
GRANT USAGE, OPERATE, MONITOR ON WAREHOUSE <% pipeline_warehouse %> TO ROLE AGENT_OBS_INGEST_ROLE;
GRANT USAGE ON WAREHOUSE <% pipeline_warehouse %> TO ROLE AGENT_OBS_APP_ROLE;

-- Database (owned by ingest role) ------------------------------------
CREATE DATABASE IF NOT EXISTS AGENT_OBS COMMENT = 'Agent Observability mart (RAW -> CORE -> MART)';
GRANT OWNERSHIP ON DATABASE AGENT_OBS TO ROLE AGENT_OBS_INGEST_ROLE COPY CURRENT GRANTS;

-- Source access -------------------------------------------------------
GRANT DATABASE ROLE SNOWFLAKE.USAGE_VIEWER          TO ROLE AGENT_OBS_INGEST_ROLE;
GRANT DATABASE ROLE SNOWFLAKE.GOVERNANCE_VIEWER     TO ROLE AGENT_OBS_INGEST_ROLE;
GRANT DATABASE ROLE SNOWFLAKE.SECURITY_VIEWER       TO ROLE AGENT_OBS_INGEST_ROLE;
GRANT APPLICATION ROLE SNOWFLAKE.AI_OBSERVABILITY_READER TO ROLE AGENT_OBS_INGEST_ROLE;  -- application role, not database role
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER           TO ROLE AGENT_OBS_INGEST_ROLE;
GRANT READ UNREDACTED AI OBSERVABILITY EVENTS TABLE ON ACCOUNT TO ROLE AGENT_OBS_INGEST_ROLE;  -- content tier approved

-- Tasks / policies
GRANT EXECUTE TASK, EXECUTE MANAGED TASK ON ACCOUNT TO ROLE AGENT_OBS_INGEST_ROLE;

-- Metadata visibility for the ingest role (read-only; no data access):
--   USAGE on the database/schema of every agent, semantic view and search service,
--   MONITOR on agents (DESCRIBE AGENT) and search services, REFERENCES on semantic
--   views (SHOW/DESCRIBE), plus FUTURE grants per schema so new objects are covered.
-- Run as ACCOUNTADMIN; re-run when objects appear in new schemas. Failures (e.g. shared or
-- application-owned databases) are skipped and counted.
CREATE OR REPLACE PROCEDURE AGENT_OBS.PUBLIC.SP_GRANT_INGEST_VISIBILITY()
RETURNS STRING LANGUAGE SQL EXECUTE AS CALLER AS
$$
DECLARE
  n INT DEFAULT 0; failed INT DEFAULT 0;
  c CURSOR FOR SELECT DISTINCT KIND, DB, SC FROM _VIS_SCHEMAS;
BEGIN
  CREATE OR REPLACE TEMPORARY TABLE _VIS_SCHEMAS (KIND STRING, DB STRING, SC STRING);
  SHOW AGENTS IN ACCOUNT;
  INSERT INTO _VIS_SCHEMAS SELECT 'AGENT', "database_name", "schema_name" FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));
  SHOW SEMANTIC VIEWS IN ACCOUNT;
  INSERT INTO _VIS_SCHEMAS SELECT 'SEMANTIC VIEW', "database_name", "schema_name" FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));
  SHOW CORTEX SEARCH SERVICES IN ACCOUNT;
  INSERT INTO _VIS_SCHEMAS SELECT 'CORTEX SEARCH SERVICE', "database_name", "schema_name" FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));
  FOR r IN c DO
    LET db STRING := '"' || REPLACE(r.DB, '"', '""') || '"';
    LET sc STRING := db || '."' || REPLACE(r.SC, '"', '""') || '"';
    LET priv STRING := IFF(r.KIND = 'SEMANTIC VIEW', 'REFERENCES', 'MONITOR');
    LET plural STRING := CASE r.KIND WHEN 'AGENT' THEN 'AGENTS' WHEN 'SEMANTIC VIEW' THEN 'SEMANTIC VIEWS' ELSE 'CORTEX SEARCH SERVICES' END;
    BEGIN
      EXECUTE IMMEDIATE 'GRANT USAGE ON DATABASE ' || db || ' TO ROLE AGENT_OBS_INGEST_ROLE';
      EXECUTE IMMEDIATE 'GRANT USAGE ON SCHEMA ' || sc || ' TO ROLE AGENT_OBS_INGEST_ROLE';
      EXECUTE IMMEDIATE 'GRANT ' || priv || ' ON ALL ' || plural || ' IN SCHEMA ' || sc || ' TO ROLE AGENT_OBS_INGEST_ROLE';
      EXECUTE IMMEDIATE 'GRANT ' || priv || ' ON FUTURE ' || plural || ' IN SCHEMA ' || sc || ' TO ROLE AGENT_OBS_INGEST_ROLE';
      n := n + 1;
    EXCEPTION WHEN OTHER THEN failed := failed + 1;
    END;
  END FOR;
  RETURN n || ' schema grants applied, ' || failed || ' skipped';
END;
$$;
CALL AGENT_OBS.PUBLIC.SP_GRANT_INGEST_VISIBILITY();
DROP PROCEDURE IF EXISTS AGENT_OBS.PUBLIC.SP_GRANT_AGENT_MONITOR();
