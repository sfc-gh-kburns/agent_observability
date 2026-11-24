-- =====================================================================
-- 07_app_grants.sql — app location, query warehouse and caller grants
-- Values come from install.conf (passed by deploy.sh as -D variables).
-- The app runs every data query with CALLER'S RIGHTS, so the CORE masking
-- policies evaluate against the viewer:
--   viewer with AGENT_OBS_APP_ROLE     → metadata tier
--   viewer with AGENT_OBS_CONTENT_ROLE → content tier
-- Caller grants authorize the app's owning role (the deploy role) to act on
-- the viewer's behalf; they do not give viewers anything themselves.
-- Idempotent.
-- =====================================================================
USE ROLE <% admin_role %>;

-- Where the app lives, and the warehouse its queries run on.
CREATE DATABASE IF NOT EXISTS <% app_database %>;
CREATE SCHEMA IF NOT EXISTS <% app_database %>.<% app_schema %>;
CREATE WAREHOUSE IF NOT EXISTS <% app_warehouse %>
  WAREHOUSE_SIZE = <% app_warehouse_size %> AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE
  COMMENT = 'Query warehouse for Snowflake App Runtime apps';

-- The deploy role owns the application service; it needs to create it.
GRANT USAGE ON DATABASE <% app_database %> TO ROLE <% app_owner_role %>;
GRANT USAGE, CREATE APPLICATION SERVICE, CREATE ARTIFACT REPOSITORY ON SCHEMA <% app_database %>.<% app_schema %> TO ROLE <% app_owner_role %>;
GRANT USAGE ON WAREHOUSE <% app_warehouse %> TO ROLE <% app_owner_role %>;

GRANT CALLER USAGE ON DATABASE AGENT_OBS TO ROLE <% app_owner_role %>;
GRANT CALLER USAGE ON SCHEMA AGENT_OBS.MART TO ROLE <% app_owner_role %>;
GRANT INHERITED CALLER SELECT ON ALL VIEWS IN SCHEMA AGENT_OBS.MART TO ROLE <% app_owner_role %>;
GRANT INHERITED CALLER SELECT ON ALL DYNAMIC TABLES IN SCHEMA AGENT_OBS.MART TO ROLE <% app_owner_role %>;
GRANT INHERITED CALLER USAGE ON ALL FUNCTIONS IN SCHEMA AGENT_OBS.MART TO ROLE <% app_owner_role %>;
GRANT INHERITED CALLER USAGE ON ALL PROCEDURES IN SCHEMA AGENT_OBS.MART TO ROLE <% app_owner_role %>;
GRANT CALLER USAGE ON WAREHOUSE <% app_warehouse %> TO ROLE <% app_owner_role %>;

-- Viewers: the metadata-tier role can use the app's query warehouse.
GRANT USAGE ON WAREHOUSE <% app_warehouse %> TO ROLE AGENT_OBS_APP_ROLE;
-- Opening the app (GRANT USAGE ON APPLICATION SERVICE ...) is granted by deploy.sh
-- after the app exists, to the roles listed in VIEWER_ROLES.
