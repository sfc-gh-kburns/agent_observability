-- =====================================================================
-- 07_app_grants.sql — grants for the SAR app (SNOWFLAKE_APPS.PUBLIC.AGENT_OBSERVABILITY)
-- The app runs every data query with CALLER'S RIGHTS, so the CORE masking
-- policies evaluate against the viewer:
--   viewer with AGENT_OBS_APP_ROLE     → metadata tier
--   viewer with AGENT_OBS_CONTENT_ROLE → content tier
-- Caller grants authorize the app's owning role (the deploy role) to act on
-- the viewer's behalf; they do not give viewers anything themselves.
-- =====================================================================
USE ROLE ACCOUNTADMIN;
SET app_owner = 'ACCOUNTADMIN';      -- role that owns the application service (deploy role)

GRANT CALLER USAGE ON DATABASE AGENT_OBS TO ROLE IDENTIFIER($app_owner);
GRANT CALLER USAGE ON SCHEMA AGENT_OBS.MART TO ROLE IDENTIFIER($app_owner);
GRANT INHERITED CALLER SELECT ON ALL VIEWS IN SCHEMA AGENT_OBS.MART TO ROLE IDENTIFIER($app_owner);
GRANT INHERITED CALLER SELECT ON ALL DYNAMIC TABLES IN SCHEMA AGENT_OBS.MART TO ROLE IDENTIFIER($app_owner);
GRANT INHERITED CALLER USAGE ON ALL FUNCTIONS IN SCHEMA AGENT_OBS.MART TO ROLE IDENTIFIER($app_owner);
GRANT INHERITED CALLER USAGE ON ALL PROCEDURES IN SCHEMA AGENT_OBS.MART TO ROLE IDENTIFIER($app_owner);
GRANT CALLER USAGE ON WAREHOUSE SNOWFLAKE_APPS_QUERY_WH TO ROLE IDENTIFIER($app_owner);

-- Viewers: the metadata-tier role can use the app's query warehouse.
GRANT USAGE ON WAREHOUSE SNOWFLAKE_APPS_QUERY_WH TO ROLE AGENT_OBS_APP_ROLE;
-- To let a role open the app:  GRANT USAGE ON APPLICATION SERVICE SNOWFLAKE_APPS.PUBLIC.AGENT_OBSERVABILITY TO ROLE <role>;
