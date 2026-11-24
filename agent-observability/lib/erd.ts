/**
 * Data-model diagrams for the Docs page: entities, key columns, joins and
 * layout. Column lists and lineage come from lib/erd-columns.ts (generated
 * from INFORMATION_SCHEMA and GET_LINEAGE); __tests__/lib/erd.test.ts checks
 * every key and join here against them.
 */
import { ERD_COLUMNS, ERD_DYNAMIC_TABLES, ERD_LINEAGE } from '@/lib/erd-columns';

export type ErdKey = {
  /** Column name, or a short name for a JSON path. */
  c: string;
  r?: 'pk' | 'fk';
  /** For values inside a VARIANT column, e.g. RECORD_ATTRIBUTES:"snow.ai.observability.agent.request_id". */
  path?: string;
};

export type ErdEntity = {
  id: string;
  label: string;
  /** Fully qualified name when the entity is a real table or view; omitted for SHOW / DESCRIBE results. */
  fqn?: string;
  kind: string;
  group: string;
  col: number;
  keys: ErdKey[];
  description: string;
  /** MART views (or other objects) that expose this entity. */
  exposedAs?: string[];
  compact?: boolean;
};

export type ErdRelation = {
  from: { e: string; c?: string };
  to: { e: string; c?: string };
  label: string;
  /** join: key equality; loose: matched by time window or parsed text; flow: data movement. */
  kind: 'join' | 'loose' | 'flow';
  /** Cardinality shown at the ends, e.g. ['N', '1']. */
  card?: [string, string];
};

export type ErdGroup = { id: string; label: string; color: string };

export type ErdDiagram = {
  id: string;
  title: string;
  description: string;
  groups: ErdGroup[];
  entities: ErdEntity[];
  relations: ErdRelation[];
  /** Column headings drawn above the diagram. */
  columns?: string[];
};

const AU = 'SNOWFLAKE.ACCOUNT_USAGE.';
const EV = 'RECORD_ATTRIBUTES:"snow.ai.observability.';

// ------------------------------------------------------------------ 1. Snowflake sources
const SOURCES: ErdDiagram = {
  id: 'sources',
  title: 'Snowflake sources',
  description:
    'The Snowflake metadata the app is built from, and how the pieces join. REQUEST_ID ties a billed turn in the usage views to its trace in the event table; QUERY_ID ties agent SQL to warehouse metrics; user and agent names tie everything to people and agents.',
  columns: ['Automations', 'Usage & billing (ACCOUNT_USAGE)', 'Traces (event table)', 'Objects & queries'],
  groups: [
    { id: 'usage', label: 'Usage & billing', color: 'var(--chart-2)' },
    { id: 'trace', label: 'Traces', color: 'var(--chart-1)' },
    { id: 'object', label: 'Objects & queries', color: 'var(--chart-4)' },
    { id: 'task', label: 'Tasks', color: 'var(--chart-3)' },
  ],
  entities: [
    {
      id: 'tasks', label: 'TASKS', fqn: `${AU}TASKS`, kind: 'view', group: 'task', col: 0,
      description: 'Every task, including users’ automations in USER$<name> databases. CoWork automations live in the SNOWFLAKE_INTELLIGENCE schema and call SYSTEM$CORTEX_DATA_AGENT_RUN_V2; Cortex Code automations are COCO_ROUTINE_* agent tasks in PUBLIC.',
      keys: [{ c: 'ID', r: 'pk' }, { c: 'TASK_DATABASE', r: 'fk' }, { c: 'TASK_SCHEMA' }, { c: 'TASK_NAME' }, { c: 'DEFINITION', r: 'fk' }, { c: 'SCHEDULE' }, { c: 'STATE' }, { c: 'DELETED' }],
    },
    {
      id: 'task_history', label: 'TASK_HISTORY', fqn: `${AU}TASK_HISTORY`, kind: 'view', group: 'task', col: 0,
      description: 'One row per task run: state, timing, error and the run’s query id.',
      keys: [{ c: 'DATABASE_NAME', r: 'fk' }, { c: 'SCHEMA_NAME', r: 'fk' }, { c: 'NAME', r: 'fk' }, { c: 'SCHEDULED_TIME' }, { c: 'STATE' }, { c: 'ERROR_MESSAGE' }, { c: 'QUERY_ID', r: 'fk' }],
    },
    {
      id: 'serverless', label: 'SERVERLESS_TASK_HISTORY', fqn: `${AU}SERVERLESS_TASK_HISTORY`, kind: 'view', group: 'task', col: 0,
      description: 'Hourly serverless compute per task. Its TASK_ID is a numeric id, not TASKS.ID, so join on database, schema and task name.',
      keys: [{ c: 'DATABASE_NAME', r: 'fk' }, { c: 'SCHEMA_NAME', r: 'fk' }, { c: 'TASK_NAME', r: 'fk' }, { c: 'START_TIME' }, { c: 'CREDITS_USED' }],
    },
    {
      id: 'cowork_usage', label: 'SNOWFLAKE_COWORK_USAGE_HISTORY', fqn: `${AU}SNOWFLAKE_COWORK_USAGE_HISTORY`, kind: 'view', group: 'usage', col: 1,
      description: 'One row per CoWork turn with authoritative credits and tokens. METADATA holds trigger_type (manual / automation), role and per-turn AI-function and SQL credits.',
      keys: [{ c: 'REQUEST_ID', r: 'pk' }, { c: 'THREAD_ID' }, { c: 'USER_NAME', r: 'fk' }, { c: 'AGENT_NAME', r: 'fk' }, { c: 'START_TIME' }, { c: 'TOKEN_CREDITS' }, { c: 'CREDITS_GRANULAR' }, { c: 'trigger_type', path: 'METADATA:trigger_type' }],
    },
    {
      id: 'agent_usage', label: 'CORTEX_AGENT_USAGE_HISTORY', fqn: `${AU}CORTEX_AGENT_USAGE_HISTORY`, kind: 'view', group: 'usage', col: 1,
      description: 'One row per agent turn from every other interface (Agent API, admin UI, SQL function, evals). Same shape as the CoWork view; METADATA:interaction_interface says where it came from.',
      keys: [{ c: 'REQUEST_ID', r: 'pk' }, { c: 'THREAD_ID' }, { c: 'USER_NAME', r: 'fk' }, { c: 'AGENT_NAME', r: 'fk' }, { c: 'START_TIME' }, { c: 'TOKEN_CREDITS' }, { c: 'CREDITS_GRANULAR' }, { c: 'interaction_interface', path: 'METADATA:interaction_interface' }],
    },
    {
      id: 'code_usage', label: 'CORTEX_CODE_*_USAGE_HISTORY', fqn: `${AU}CORTEX_CODE_*_USAGE_HISTORY`, kind: 'view ×3', group: 'usage', col: 1,
      description: 'Cortex Code usage, one view per surface: CORTEX_CODE_DESKTOP_, _SNOWSIGHT_ and _CLI_USAGE_HISTORY (same columns). Cortex Code owns no agent object; its requests leave “passthrough” traces in the event table.',
      keys: [{ c: 'REQUEST_ID', r: 'pk' }, { c: 'THREAD_ID' }, { c: 'USER_NAME', r: 'fk' }, { c: 'USAGE_TIME' }, { c: 'TOKEN_CREDITS' }],
    },
    {
      id: 'ai_functions', label: 'CORTEX_AI_FUNCTIONS_USAGE_HISTORY', fqn: `${AU}CORTEX_AI_FUNCTIONS_USAGE_HISTORY`, kind: 'view', group: 'usage', col: 1,
      description: 'Credits for AI SQL functions (AI_COMPLETE, AI_CLASSIFY, …) per query.',
      keys: [{ c: 'QUERY_ID', r: 'fk' }, { c: 'USER_ID', r: 'fk' }, { c: 'FUNCTION_NAME' }, { c: 'MODEL_NAME' }, { c: 'CREDITS' }],
    },
    {
      id: 'events', label: 'AI_OBSERVABILITY_EVENTS', fqn: 'SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS', kind: 'event table', group: 'trace', col: 2,
      description: 'OpenTelemetry traces for every agent turn. One root span per turn (RECORD:name = AgentV2RequestResponseInfo) holds the question, answer and status; child spans hold planning steps and tool calls. Feedback events (CORTEX_AGENT_FEEDBACK) have no trace. TIMESTAMP is UTC without a time zone.',
      keys: [
        { c: 'trace_id', r: 'pk', path: 'TRACE:trace_id' },
        { c: 'span_id', path: 'TRACE:span_id' },
        { c: 'name', path: 'RECORD:name' },
        { c: 'request_id', r: 'fk', path: `${EV}agent.request_id"` },
        { c: 'thread_id', path: `${EV}agent.thread_id"` },
        { c: 'object.name', r: 'fk', path: `${EV}object.name"` },
        { c: 'user.name', r: 'fk', path: `${EV}user.name"` },
        { c: 'sql_execution.query_id', r: 'fk', path: `${EV}agent.tool.sql_execution.query_id"` },
        { c: 'semantic_model', r: 'fk', path: `${EV}agent.tool.cortex_analyst.semantic_model"` },
        { c: 'record_root.input', path: 'RECORD_ATTRIBUTES:"ai.observability.record_root.input"' },
        { c: 'TIMESTAMP' },
      ],
    },
    {
      id: 'agents', label: 'SHOW / DESCRIBE AGENT', kind: 'command', group: 'object', col: 3,
      description: 'Agent objects. SHOW AGENTS IN ACCOUNT lists them; DESCRIBE AGENT returns agent_spec (JSON) with the model, budget, instructions and tools. The pipeline snapshots each spec hourly.',
      keys: [{ c: 'database_name', r: 'pk' }, { c: 'schema_name', r: 'pk' }, { c: 'name', r: 'pk' }, { c: 'owner' }, { c: 'tools', r: 'fk', path: 'agent_spec:tools' }],
    },
    {
      id: 'assets', label: 'SEMANTIC VIEWS / SEARCH SERVICES', kind: 'command', group: 'object', col: 3,
      description: 'SHOW SEMANTIC VIEWS IN ACCOUNT and SHOW CORTEX SEARCH SERVICES IN ACCOUNT: what agent tools can point at.',
      keys: [{ c: 'database_name', r: 'pk' }, { c: 'schema_name', r: 'pk' }, { c: 'name', r: 'pk' }, { c: 'owner' }],
    },
    {
      id: 'query_history', label: 'QUERY_HISTORY', fqn: `${AU}QUERY_HISTORY`, kind: 'view', group: 'object', col: 3,
      description: 'Warehouse, timing, bytes scanned and errors for the SQL an agent ran (and for task and AI-function queries).',
      keys: [{ c: 'QUERY_ID', r: 'pk' }, { c: 'WAREHOUSE_NAME' }, { c: 'EXECUTION_STATUS' }, { c: 'TOTAL_ELAPSED_TIME' }, { c: 'BYTES_SCANNED' }, { c: 'ERROR_MESSAGE' }],
    },
    {
      id: 'users', label: 'USERS', fqn: `${AU}USERS`, kind: 'view', group: 'object', col: 3,
      description: 'Users. TYPE (PERSON / SERVICE / LEGACY_SERVICE …) tells people from service accounts.',
      keys: [{ c: 'USER_ID', r: 'pk' }, { c: 'NAME', r: 'pk' }, { c: 'TYPE' }, { c: 'DISPLAY_NAME' }, { c: 'EMAIL' }],
    },
  ],
  relations: [
    { from: { e: 'cowork_usage', c: 'REQUEST_ID' }, to: { e: 'events', c: 'request_id' }, label: 'REQUEST_ID = agent.request_id', kind: 'join', card: ['1', '1'] },
    { from: { e: 'agent_usage', c: 'REQUEST_ID' }, to: { e: 'events', c: 'request_id' }, label: 'REQUEST_ID = agent.request_id', kind: 'join', card: ['1', '1'] },
    { from: { e: 'code_usage', c: 'REQUEST_ID' }, to: { e: 'events', c: 'request_id' }, label: 'REQUEST_ID = agent.request_id (passthrough traces)', kind: 'join', card: ['1', '1'] },
    { from: { e: 'cowork_usage', c: 'USER_NAME' }, to: { e: 'users', c: 'NAME' }, label: 'USER_NAME = NAME', kind: 'join', card: ['N', '1'] },
    { from: { e: 'agent_usage', c: 'USER_NAME' }, to: { e: 'users', c: 'NAME' }, label: 'USER_NAME = NAME', kind: 'join', card: ['N', '1'] },
    { from: { e: 'code_usage', c: 'USER_NAME' }, to: { e: 'users', c: 'NAME' }, label: 'USER_NAME = NAME', kind: 'join', card: ['N', '1'] },
    { from: { e: 'ai_functions', c: 'USER_ID' }, to: { e: 'users', c: 'USER_ID' }, label: 'USER_ID', kind: 'join', card: ['N', '1'] },
    { from: { e: 'events', c: 'user.name' }, to: { e: 'users', c: 'NAME' }, label: 'user.name = NAME', kind: 'join', card: ['N', '1'] },
    { from: { e: 'cowork_usage', c: 'AGENT_NAME' }, to: { e: 'agents', c: 'name' }, label: 'AGENT_DATABASE_NAME.AGENT_SCHEMA_NAME.AGENT_NAME', kind: 'join', card: ['N', '1'] },
    { from: { e: 'agent_usage', c: 'AGENT_NAME' }, to: { e: 'agents', c: 'name' }, label: 'AGENT_DATABASE_NAME.AGENT_SCHEMA_NAME.AGENT_NAME', kind: 'join', card: ['N', '1'] },
    { from: { e: 'events', c: 'object.name' }, to: { e: 'agents', c: 'name' }, label: 'database.name.schema.name.object.name', kind: 'join', card: ['N', '1'] },
    { from: { e: 'events', c: 'sql_execution.query_id' }, to: { e: 'query_history', c: 'QUERY_ID' }, label: 'sql_execution.query_id = QUERY_ID', kind: 'join', card: ['1', '1'] },
    { from: { e: 'ai_functions', c: 'QUERY_ID' }, to: { e: 'query_history', c: 'QUERY_ID' }, label: 'QUERY_ID', kind: 'join', card: ['N', '1'] },
    { from: { e: 'events', c: 'semantic_model' }, to: { e: 'assets', c: 'name' }, label: 'semantic model / search service used by a tool span', kind: 'join', card: ['N', '1'] },
    { from: { e: 'agents', c: 'tools' }, to: { e: 'assets', c: 'name' }, label: 'tool_resources → semantic view / search service (bound)', kind: 'join', card: ['N', 'N'] },
    { from: { e: 'task_history', c: 'NAME' }, to: { e: 'tasks', c: 'TASK_NAME' }, label: 'DATABASE_NAME, SCHEMA_NAME, NAME', kind: 'join', card: ['N', '1'] },
    { from: { e: 'serverless', c: 'TASK_NAME' }, to: { e: 'tasks', c: 'TASK_NAME' }, label: 'DATABASE_NAME, SCHEMA_NAME, TASK_NAME', kind: 'join', card: ['N', '1'] },
    { from: { e: 'task_history', c: 'QUERY_ID' }, to: { e: 'query_history', c: 'QUERY_ID' }, label: 'QUERY_ID', kind: 'join', card: ['1', '1'] },
    { from: { e: 'tasks', c: 'DEFINITION' }, to: { e: 'agents', c: 'name' }, label: 'target agent parsed from SYSTEM$CORTEX_DATA_AGENT_RUN_V2(\'<agent>\', …)', kind: 'loose', card: ['N', '1'] },
    { from: { e: 'tasks', c: 'TASK_DATABASE' }, to: { e: 'users', c: 'NAME' }, label: 'USER$<name> = owner', kind: 'loose', card: ['N', '1'] },
    { from: { e: 'task_history', c: 'SCHEDULED_TIME' }, to: { e: 'cowork_usage', c: 'trigger_type' }, label: 'run window ≈ turns with trigger_type = automation (same user + agent)', kind: 'loose', card: ['1', 'N'] },
  ],
};

// ------------------------------------------------------------------ 2. AGENT_OBS model
const O = 'AGENT_OBS.';
const MODEL: ErdDiagram = {
  id: 'model',
  title: 'AGENT_OBS model',
  description:
    'The analytical model the app queries: facts and dimensions in CORE (dynamic tables and views) plus the RAW history tables used directly. Each box lists the MART view that exposes it; the app reads only MART.',
  columns: ['Dimensions', 'Turns & threads', 'Traces & SQL', 'Questions', 'Cortex Code, AI functions & automations'],
  groups: [
    { id: 'dim', label: 'Dimension', color: 'var(--chart-4)' },
    { id: 'fact', label: 'Fact', color: 'var(--chart-1)' },
    { id: 'trace', label: 'Trace fact', color: 'var(--chart-2)' },
    { id: 'raw', label: 'RAW history', color: 'var(--chart-3)' },
  ],
  entities: [
    {
      id: 'dim_user', label: 'DIM_USER', fqn: `${O}CORE.DIM_USER`, kind: 'view', group: 'dim', col: 0, exposedAs: ['MART.V_USER'],
      description: 'Every user seen in USERS or in usage, with type and display name.',
      keys: [{ c: 'USER_ID', r: 'pk' }, { c: 'USER_NAME' }, { c: 'USER_TYPE' }, { c: 'DISPLAY_NAME' }],
    },
    {
      id: 'dim_agent', label: 'DIM_AGENT', fqn: `${O}CORE.DIM_AGENT`, kind: 'view (SCD2)', group: 'dim', col: 0, exposedAs: ['MART.V_AGENT_CONFIG', 'MART.V_AGENT_CONFIG_CHANGES'],
      description: 'One row per agent configuration version (SCD2): parsed spec, model, budget, tool counts and capabilities. IS_CURRENT marks the live version.',
      keys: [{ c: 'AGENT_FQN', r: 'pk' }, { c: 'VALID_FROM', r: 'pk' }, { c: 'VALID_TO' }, { c: 'IS_CURRENT' }, { c: 'ORCHESTRATION_MODEL' }, { c: 'OWNER' }, { c: 'TOOL_COUNT' }],
    },
    {
      id: 'dim_agent_tool', label: 'DIM_AGENT_TOOL', fqn: `${O}CORE.DIM_AGENT_TOOL`, kind: 'view (SCD2)', group: 'dim', col: 0, exposedAs: ['MART.V_AGENT_TOOL'],
      description: 'One row per tool in each agent configuration version, with the semantic view or search service it points at.',
      keys: [{ c: 'AGENT_FQN', r: 'fk' }, { c: 'VALID_FROM', r: 'fk' }, { c: 'TOOL_NAME' }, { c: 'TOOL_TYPE' }, { c: 'RESOURCE_FQN', r: 'fk' }],
    },
    {
      id: 'dim_asset', label: 'DIM_ASSET', fqn: `${O}CORE.DIM_ASSET`, kind: 'view', group: 'dim', col: 0, exposedAs: ['MART.V_ASSET', 'MART.V_ASSET_CATALOG_30D'],
      description: 'Semantic views and Cortex Search services, from daily snapshots; IS_DROPPED when no longer visible.',
      keys: [{ c: 'ASSET_KEY', r: 'pk' }, { c: 'ASSET_FQN' }, { c: 'ASSET_TYPE' }, { c: 'VERIFIED_QUERY_COUNT' }, { c: 'IS_DROPPED' }],
    },
    {
      id: 'fact_thread', label: 'FACT_THREAD', fqn: `${O}CORE.FACT_THREAD`, kind: 'dynamic table', group: 'fact', col: 1, exposedAs: ['MART.V_THREAD'],
      description: 'One row per conversation: first question, agents, users, turns, credits, failures and feedback.',
      keys: [{ c: 'THREAD_ID', r: 'pk' }, { c: 'FIRST_AGENT_FQN', r: 'fk' }, { c: 'USER_NAME' }, { c: 'TURNS' }, { c: 'COMBINED_CREDITS' }, { c: 'FAILED_TURNS' }],
    },
    {
      id: 'fact_turn', label: 'FACT_TURN', fqn: `${O}CORE.FACT_TURN`, kind: 'dynamic table', group: 'fact', col: 1, exposedAs: ['MART.V_TURN', 'MART.AGG_*_DAILY', 'MART.V_END_USER_TURN'],
      description: 'The central fact: one row per turn. Usage (authoritative cost) joined to the root span (question, answer, status) and trace rollups. Turns with no usage row (traces only) and with no trace (usage only) are both kept.',
      keys: [
        { c: 'TURN_ID', r: 'pk' }, { c: 'REQUEST_ID' }, { c: 'TRACE_ID', r: 'fk' }, { c: 'THREAD_ID', r: 'fk' }, { c: 'USER_ID', r: 'fk' },
        { c: 'AGENT_NAME', r: 'fk' }, { c: 'QUESTION_HASH', r: 'fk' }, { c: 'INTERFACE' }, { c: 'TRIGGER_TYPE' }, { c: 'START_TIME_UTC' }, { c: 'COMBINED_CREDITS' }, { c: 'IS_SUCCESS' },
      ],
    },
    {
      id: 'fact_model', label: 'FACT_TURN_MODEL_USAGE', fqn: `${O}CORE.FACT_TURN_MODEL_USAGE`, kind: 'dynamic table', group: 'fact', col: 1, exposedAs: ['MART.V_TURN_MODEL_USAGE', 'MART.AGG_MODEL_DAILY'],
      description: 'Tokens and credits per turn × step × service type × model, flattened from TOKENS_GRANULAR / CREDITS_GRANULAR.',
      keys: [{ c: 'REQUEST_ID', r: 'fk' }, { c: 'STEP_INDEX' }, { c: 'SERVICE_TYPE' }, { c: 'MODEL' }, { c: 'TOKENS_TOTAL' }, { c: 'CREDITS_TOTAL' }],
    },
    {
      id: 'fact_feedback', label: 'FACT_FEEDBACK', fqn: `${O}CORE.FACT_FEEDBACK`, kind: 'dynamic table', group: 'fact', col: 1, exposedAs: ['MART.V_FEEDBACK', 'MART.AGG_FEEDBACK_DAILY'],
      description: 'Thumbs up / down and comments, matched to the rated turn (TURN_MATCH says how).',
      keys: [{ c: 'EVENT_HASH', r: 'pk' }, { c: 'TURN_ID', r: 'fk' }, { c: 'THREAD_ID' }, { c: 'IS_POSITIVE' }, { c: 'FEEDBACK_TEXT' }],
    },
    {
      id: 'span_stats', label: 'TURN_SPAN_STATS', fqn: `${O}CORE.TURN_SPAN_STATS`, kind: 'dynamic table', group: 'trace', col: 2,
      description: 'Per-trace rollup of spans: planning steps, tool calls, SQL calls and errors, verified-query hits, time split.',
      keys: [{ c: 'TRACE_ID', r: 'pk' }, { c: 'PLANNING_STEPS' }, { c: 'TOOL_CALLS' }, { c: 'SQL_ERRORS' }, { c: 'VERIFIED_QUERY_HITS' }],
    },
    {
      id: 'fact_span', label: 'FACT_SPAN', fqn: `${O}CORE.FACT_SPAN`, kind: 'dynamic table', group: 'trace', col: 2, exposedAs: ['MART.V_SPAN', 'MART.AGG_TOOL_DAILY'],
      description: 'Every span of every trace, with a category (planning, sql, search, response, …), tool, resource, timing and tokens.',
      keys: [{ c: 'EVENT_HASH', r: 'pk' }, { c: 'TRACE_ID', r: 'fk' }, { c: 'SPAN_ID' }, { c: 'PARENT_SPAN_ID' }, { c: 'SPAN_CATEGORY' }, { c: 'TOOL_NAME' }, { c: 'RESOURCE_FQN', r: 'fk' }, { c: 'QUERY_ID' }],
    },
    {
      id: 'fact_sql', label: 'FACT_SQL_EXECUTION', fqn: `${O}CORE.FACT_SQL_EXECUTION`, kind: 'dynamic table', group: 'trace', col: 2, exposedAs: ['MART.V_SQL_EXECUTION'],
      description: 'SQL the agent ran: generated and final SQL, status, verified-query use, plus warehouse metrics (QH_*) from query history.',
      keys: [{ c: 'EVENT_HASH', r: 'pk' }, { c: 'TRACE_ID', r: 'fk' }, { c: 'SPAN_ID', r: 'fk' }, { c: 'QUERY_ID', r: 'fk' }, { c: 'SEMANTIC_MODEL' }, { c: 'IS_ERROR' }, { c: 'FINAL_SQL' }],
    },
    {
      id: 'fact_search', label: 'FACT_SEARCH_CALL', fqn: `${O}CORE.FACT_SEARCH_CALL`, kind: 'dynamic table', group: 'trace', col: 2, exposedAs: ['MART.V_SEARCH_CALL'],
      description: 'Cortex Search calls: service, query, result count and latency.',
      keys: [{ c: 'EVENT_HASH', r: 'pk' }, { c: 'SPAN_ID', r: 'fk' }, { c: 'SEARCH_SERVICE_FQN', r: 'fk' }, { c: 'RESULT_COUNT' }],
    },
    {
      id: 'query_history', label: 'AGENT_QUERY_HISTORY', fqn: `${O}RAW.AGENT_QUERY_HISTORY`, kind: 'table', group: 'raw', col: 2,
      description: 'QUERY_HISTORY rows for queries agents ran, kept after ACCOUNT_USAGE ages them out.',
      keys: [{ c: 'QUERY_ID', r: 'pk' }, { c: 'WAREHOUSE_NAME' }, { c: 'EXECUTION_STATUS' }, { c: 'TOTAL_ELAPSED_TIME' }],
    },
    {
      id: 'q_enrich', label: 'QUESTION_ENRICHMENT', fqn: `${O}RAW.QUESTION_ENRICHMENT`, kind: 'table', group: 'raw', col: 3, exposedAs: ['MART.V_QUESTION_TURN'],
      description: 'AI_COMPLETE classification of each distinct question (intent, domain, metrics, canonical form) and its AI_EMBED vector.',
      keys: [{ c: 'QUESTION_HASH', r: 'pk' }, { c: 'INTENT' }, { c: 'DOMAIN' }, { c: 'CANONICAL_QUESTION' }, { c: 'EMBEDDING' }],
    },
    {
      id: 'q_cluster', label: 'QUESTION_CLUSTER', fqn: `${O}CORE.QUESTION_CLUSTER`, kind: 'table', group: 'fact', col: 3, exposedAs: ['MART.V_QUESTION_TURN'],
      description: 'Theme per agent and question: near-duplicate canonical questions grouped by embedding similarity.',
      keys: [{ c: 'AGENT_KEY', r: 'pk' }, { c: 'QUESTION_HASH', r: 'pk' }, { c: 'THEME_ID' }, { c: 'THEME_LABEL' }, { c: 'SIMILARITY' }],
    },
    {
      id: 'code', label: 'CODE_USAGE', fqn: `${O}RAW.CODE_USAGE`, kind: 'table', group: 'raw', col: 4, exposedAs: ['MART.V_CODE_USAGE_DAILY', 'MART.V_CODE_MODEL_DAILY'],
      description: 'Cortex Code requests from all three surfaces (SURFACE = DESKTOP / SNOWSIGHT / CLI).',
      keys: [{ c: 'REQUEST_ID', r: 'pk' }, { c: 'SURFACE' }, { c: 'USER_ID', r: 'fk' }, { c: 'THREAD_ID' }, { c: 'USAGE_TIME' }, { c: 'TOKEN_CREDITS' }],
    },
    {
      id: 'ai_fn', label: 'AI_FUNCTION_USAGE_DAILY', fqn: `${O}RAW.AI_FUNCTION_USAGE_DAILY`, kind: 'table', group: 'raw', col: 4, exposedAs: ['MART.V_AI_SPEND_DAILY'],
      description: 'AI SQL function credits per day, function, model and user.',
      keys: [{ c: 'DAY', r: 'pk' }, { c: 'FUNCTION_NAME', r: 'pk' }, { c: 'MODEL_NAME', r: 'pk' }, { c: 'USER_ID', r: 'fk' }, { c: 'CREDITS' }],
    },
    {
      id: 'auto_task', label: 'AUTOMATION_TASK', fqn: `${O}RAW.AUTOMATION_TASK`, kind: 'table', group: 'raw', col: 4, exposedAs: ['MART.V_AUTOMATION'],
      description: 'Every user automation (CoWork, Cortex Code, Agent SDK) with parsed target agent and prompt; deleted ones are kept.',
      keys: [{ c: 'TASK_ID', r: 'pk' }, { c: 'KIND' }, { c: 'TASK_NAME' }, { c: 'OWNER_USER', r: 'fk' }, { c: 'TARGET_AGENT', r: 'fk' }, { c: 'SCHEDULE' }],
    },
    {
      id: 'auto_run', label: 'AUTOMATION_RUN', fqn: `${O}RAW.AUTOMATION_RUN`, kind: 'table', group: 'raw', col: 4, exposedAs: ['MART.V_AUTOMATION_RUN'],
      description: 'One row per automation run from TASK_HISTORY.',
      keys: [{ c: 'RUN_KEY', r: 'pk' }, { c: 'TASK_NAME', r: 'fk' }, { c: 'SCHEDULED_TIME' }, { c: 'STATE' }, { c: 'QUERY_ID' }],
    },
    {
      id: 'auto_credits', label: 'AUTOMATION_TASK_CREDITS', fqn: `${O}RAW.AUTOMATION_TASK_CREDITS`, kind: 'table', group: 'raw', col: 4,
      description: 'Hourly serverless task compute for automations.',
      keys: [{ c: 'TASK_NAME', r: 'fk' }, { c: 'START_TIME' }, { c: 'CREDITS_USED' }],
    },
  ],
  relations: [
    { from: { e: 'fact_turn', c: 'THREAD_ID' }, to: { e: 'fact_thread', c: 'THREAD_ID' }, label: 'THREAD_ID', kind: 'join', card: ['N', '1'] },
    { from: { e: 'fact_turn', c: 'USER_ID' }, to: { e: 'dim_user', c: 'USER_ID' }, label: 'USER_ID', kind: 'join', card: ['N', '1'] },
    { from: { e: 'fact_turn', c: 'AGENT_NAME' }, to: { e: 'dim_agent', c: 'AGENT_FQN' }, label: 'agent db.schema.name = AGENT_FQN (IS_CURRENT, or version valid at START_TIME_UTC)', kind: 'join', card: ['N', '1'] },
    { from: { e: 'fact_thread', c: 'FIRST_AGENT_FQN' }, to: { e: 'dim_agent', c: 'AGENT_FQN' }, label: 'FIRST_AGENT_FQN = AGENT_FQN', kind: 'join', card: ['N', '1'] },
    { from: { e: 'dim_agent_tool', c: 'AGENT_FQN' }, to: { e: 'dim_agent', c: 'AGENT_FQN' }, label: 'AGENT_FQN, VALID_FROM', kind: 'join', card: ['N', '1'] },
    { from: { e: 'dim_agent_tool', c: 'RESOURCE_FQN' }, to: { e: 'dim_asset', c: 'ASSET_KEY' }, label: 'RESOURCE_FQN → asset (bound)', kind: 'join', card: ['N', '1'] },
    { from: { e: 'fact_model', c: 'REQUEST_ID' }, to: { e: 'fact_turn', c: 'REQUEST_ID' }, label: 'REQUEST_ID', kind: 'join', card: ['N', '1'] },
    { from: { e: 'fact_feedback', c: 'TURN_ID' }, to: { e: 'fact_turn', c: 'TURN_ID' }, label: 'TURN_ID (rated message → turn)', kind: 'join', card: ['N', '1'] },
    { from: { e: 'span_stats', c: 'TRACE_ID' }, to: { e: 'fact_turn', c: 'TRACE_ID' }, label: 'TRACE_ID', kind: 'join', card: ['1', '1'] },
    { from: { e: 'fact_span', c: 'TRACE_ID' }, to: { e: 'fact_turn', c: 'TRACE_ID' }, label: 'TRACE_ID', kind: 'join', card: ['N', '1'] },
    { from: { e: 'fact_span', c: 'RESOURCE_FQN' }, to: { e: 'dim_asset', c: 'ASSET_KEY' }, label: 'RESOURCE_FQN → asset (used)', kind: 'join', card: ['N', '1'] },
    { from: { e: 'fact_sql', c: 'SPAN_ID' }, to: { e: 'fact_span', c: 'SPAN_ID' }, label: 'TRACE_ID, SPAN_ID', kind: 'join', card: ['1', '1'] },
    { from: { e: 'fact_search', c: 'SPAN_ID' }, to: { e: 'fact_span', c: 'SPAN_ID' }, label: 'TRACE_ID, SPAN_ID', kind: 'join', card: ['1', '1'] },
    { from: { e: 'fact_sql', c: 'QUERY_ID' }, to: { e: 'query_history', c: 'QUERY_ID' }, label: 'QUERY_ID', kind: 'join', card: ['1', '1'] },
    { from: { e: 'q_enrich', c: 'QUESTION_HASH' }, to: { e: 'fact_turn', c: 'QUESTION_HASH' }, label: 'QUESTION_HASH', kind: 'join', card: ['1', 'N'] },
    { from: { e: 'q_cluster', c: 'QUESTION_HASH' }, to: { e: 'q_enrich', c: 'QUESTION_HASH' }, label: 'QUESTION_HASH (+ AGENT_KEY)', kind: 'join', card: ['N', '1'] },
    { from: { e: 'code', c: 'USER_ID' }, to: { e: 'dim_user', c: 'USER_ID' }, label: 'USER_ID', kind: 'join', card: ['N', '1'] },
    { from: { e: 'ai_fn', c: 'USER_ID' }, to: { e: 'dim_user', c: 'USER_ID' }, label: 'USER_ID', kind: 'join', card: ['N', '1'] },
    { from: { e: 'auto_run', c: 'TASK_NAME' }, to: { e: 'auto_task', c: 'TASK_NAME' }, label: 'TASK_DATABASE, TASK_SCHEMA, TASK_NAME', kind: 'join', card: ['N', '1'] },
    { from: { e: 'auto_credits', c: 'TASK_NAME' }, to: { e: 'auto_task', c: 'TASK_NAME' }, label: 'TASK_DATABASE, TASK_SCHEMA, TASK_NAME', kind: 'join', card: ['N', '1'] },
    { from: { e: 'auto_task', c: 'TARGET_AGENT' }, to: { e: 'dim_agent', c: 'AGENT_FQN' }, label: 'TARGET_AGENT = agent db.schema.name', kind: 'join', card: ['N', '1'] },
    { from: { e: 'auto_task', c: 'OWNER_USER' }, to: { e: 'dim_user', c: 'USER_NAME' }, label: 'OWNER_USER = USER_NAME', kind: 'join', card: ['N', '1'] },
    { from: { e: 'auto_run', c: 'SCHEDULED_TIME' }, to: { e: 'fact_turn', c: 'TRIGGER_TYPE' }, label: 'run window ≈ turns with TRIGGER_TYPE = automation (same user + agent)', kind: 'loose', card: ['1', 'N'] },
  ],
};

// ------------------------------------------------------------------ 3. Data flow (lineage)
const LOADERS: [string, string, string][] = [
  [`${AU}SNOWFLAKE_COWORK_USAGE_HISTORY`, `${O}RAW.USAGE_TURN`, 'SP_LOAD_USAGE'],
  [`${AU}CORTEX_AGENT_USAGE_HISTORY`, `${O}RAW.USAGE_TURN`, 'SP_LOAD_USAGE'],
  [`${AU}SNOWFLAKE_INTELLIGENCE_USAGE_HISTORY`, `${O}RAW.USAGE_TURN`, 'SP_LOAD_USAGE (legacy view)'],
  ['SHOW / DESCRIBE AGENT', `${O}RAW.AGENT_CONFIG_HISTORY`, 'SP_LOAD_AGENT_CONFIG'],
  ['SHOW SEMANTIC VIEWS / SEARCH SERVICES', `${O}RAW.ASSET_SNAPSHOT`, 'SP_LOAD_ASSETS'],
  [`${AU}USERS`, `${O}RAW.USERS`, 'SP_LOAD_USERS'],
  [`${AU}QUERY_HISTORY`, `${O}RAW.AGENT_QUERY_HISTORY`, 'SP_LOAD_QUERY_HISTORY'],
  [`${AU}CORTEX_CODE_*_USAGE_HISTORY`, `${O}RAW.CODE_USAGE`, 'SP_LOAD_CODE_USAGE'],
  [`${AU}CORTEX_AI_FUNCTIONS_USAGE_HISTORY`, `${O}RAW.AI_FUNCTION_USAGE_DAILY`, 'SP_LOAD_AI_FUNCTION_USAGE'],
  [`${AU}TASKS`, `${O}RAW.AUTOMATION_TASK`, 'SP_LOAD_AUTOMATIONS'],
  [`${AU}TASK_HISTORY`, `${O}RAW.AUTOMATION_RUN`, 'SP_LOAD_AUTOMATIONS'],
  [`${AU}SERVERLESS_TASK_HISTORY`, `${O}RAW.AUTOMATION_TASK_CREDITS`, 'SP_LOAD_AUTOMATIONS'],
  [`${O}MART.V_TURN`, `${O}RAW.QUESTION_ENRICHMENT`, 'SP_ENRICH_QUESTIONS (AI_COMPLETE + AI_EMBED)'],
  [`${O}CORE.FACT_TURN`, `${O}CORE.QUESTION_CLUSTER`, 'SP_CLUSTER_QUESTIONS'],
];

/** Layer a node sits in, from its name. */
function flowGroup(id: string): string {
  if (!id.startsWith(O)) return 'source';
  return id.split('.')[1].toLowerCase();
}

function flowKind(id: string): string {
  if (id === 'SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS') return 'event table';
  if (!id.includes('.')) return 'command';
  if (!id.startsWith(O)) return id.includes('*') ? 'view ×3' : 'view';
  if (ERD_DYNAMIC_TABLES.has(id)) return 'dynamic table';
  if (/\.(V_|DIM_)/.test(id)) return 'view';
  return 'table';
}

function buildFlow(): ErdDiagram {
  const edges: ErdRelation[] = [];
  const add = (src: string, tgt: string, label: string) =>
    edges.push({ from: { e: src }, to: { e: tgt }, label, kind: 'flow' });
  for (const [s, t] of ERD_LINEAGE) add(s, t, s.startsWith(O) ? 'built from (lineage)' : 'SP_LOAD_EVENTS (lineage)');
  for (const [s, t, l] of LOADERS) add(s, t, l);
  // Lanes by schema (Snowflake → RAW → CORE → MART). Inside CORE and MART, objects built
  // from others in the same schema move one sub-column right, so chains read left to right.
  const ids = [...new Set(edges.flatMap((e) => [e.from.e, e.to.e]))];
  const lane: Record<string, { base: number; span: number }> = {
    source: { base: 0, span: 1 }, raw: { base: 1, span: 1 }, admin: { base: 1, span: 1 }, core: { base: 2, span: 3 }, mart: { base: 5, span: 2 },
  };
  const inner = new Map<string, number>(ids.map((i) => [i, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const e of edges) {
      if (flowGroup(e.from.e) !== flowGroup(e.to.e)) continue;
      const d = (inner.get(e.from.e) ?? 0) + 1;
      if (d > (inner.get(e.to.e) ?? 0) && d < 20) { inner.set(e.to.e, d); changed = true; }
    }
    if (!changed) break;
  }
  const depth = new Map(ids.map((i) => {
    const l = lane[flowGroup(i)] ?? lane.raw;
    return [i, l.base + Math.min(inner.get(i) ?? 0, l.span - 1)] as const;
  }));
  const short = (id: string) => (id.startsWith(O) ? id.slice(O.length) : id.replace(/^SNOWFLAKE\.(ACCOUNT_USAGE|LOCAL)\./, ''));
  const entities: ErdEntity[] = ids.map((id) => ({
    id,
    label: short(id).split('.').pop()!,
    fqn: id.includes('.') && !id.includes('*') ? id : undefined,
    kind: flowKind(id),
    group: flowGroup(id),
    col: depth.get(id) ?? 0,
    keys: [],
    compact: true,
    description: id.startsWith(O)
      ? `${short(id)} in AGENT_OBS.`
      : id.includes('.') ? `${id}: Snowflake source.` : 'Snowflake command output, snapshotted by the pipeline.',
  }));
  const maxCol = Math.max(...entities.map((e) => e.col));
  const layerNames: Record<string, string> = { source: 'Snowflake', raw: 'RAW', core: 'CORE', mart: 'MART', admin: 'ADMIN' };
  const columns = Array.from({ length: maxCol + 1 }, (_, c) => {
    const groups = [...new Set(entities.filter((e) => e.col === c).map((e) => e.group))];
    return ['source', 'raw', 'core', 'mart', 'admin'].filter((g) => groups.includes(g)).map((g) => layerNames[g]).join(' · ');
  });
  return {
    id: 'flow',
    title: 'AGENT_OBS data flow',
    description:
      'How data moves from Snowflake into the app: load procedures copy each source into RAW (never purged), dynamic tables in CORE shape it, and MART views serve the app. Arrows inside AGENT_OBS come from SNOWFLAKE.CORE.GET_LINEAGE; arrows from the sources are the load procedures.',
    columns,
    groups: [
      { id: 'source', label: 'Snowflake source', color: 'var(--muted-foreground)' },
      { id: 'raw', label: 'RAW', color: 'var(--chart-3)' },
      { id: 'core', label: 'CORE', color: 'var(--chart-1)' },
      { id: 'mart', label: 'MART (app reads)', color: 'var(--chart-4)' },
      { id: 'admin', label: 'ADMIN', color: 'var(--chart-5)' },
    ],
    entities,
    relations: edges,
  };
}

export const ERD_DIAGRAMS: ErdDiagram[] = [SOURCES, MODEL, buildFlow()];

/** All columns for an entity, from INFORMATION_SCHEMA (empty for SHOW / DESCRIBE results). */
export function entityColumns(e: ErdEntity): [string, string][] {
  return (e.fqn && ERD_COLUMNS[e.fqn]) || ERD_COLUMNS[e.id] || [];
}

// ------------------------------------------------------------------ Layout
export const ERD_SIZE = { width: 290, compactWidth: 250, header: 46, compactHeader: 40, row: 22, footer: 24, gapX: 170, gapY: 36, compactGapX: 110, compactGapY: 12 };

export type Box = { x: number; y: number; w: number; h: number };

export function entityHeight(e: ErdEntity): number {
  if (e.compact) return ERD_SIZE.compactHeader;
  const more = entityColumns(e).length > e.keys.length;
  return ERD_SIZE.header + e.keys.length * ERD_SIZE.row + (more ? ERD_SIZE.footer : 8);
}

/**
 * Column positions are fixed by `col`. Inside a column, boxes keep their
 * listed order, except compact (flow) diagrams, which are reordered by the
 * average position of their upstream neighbours to cut down crossings.
 */
export function layoutDiagram(d: ErdDiagram): Map<string, Box> {
  const cols = new Map<number, ErdEntity[]>();
  for (const e of d.entities) cols.set(e.col, [...(cols.get(e.col) ?? []), e]);
  const order = [...cols.keys()].sort((a, b) => a - b);
  if (d.entities.some((e) => e.compact)) {
    const ups = new Map<string, string[]>();
    for (const r of d.relations) ups.set(r.to.e, [...(ups.get(r.to.e) ?? []), r.from.e]);
    const downs = new Map<string, string[]>();
    for (const r of d.relations) downs.set(r.from.e, [...(downs.get(r.from.e) ?? []), r.to.e]);
    const pos = new Map<string, number>();
    const rank = (list: ErdEntity[]) => list.forEach((e, i) => pos.set(e.id, i / Math.max(1, list.length - 1)));
    order.forEach((c) => rank(cols.get(c)!));
    const bary = (id: string, nb: Map<string, string[]>) => {
      const p = (nb.get(id) ?? []).map((n) => pos.get(n)).filter((v): v is number => v !== undefined);
      return p.length ? p.reduce((a, b) => a + b, 0) / p.length : pos.get(id) ?? 0;
    };
    for (let sweep = 0; sweep < 6; sweep++) {
      const seq = sweep % 2 === 0 ? order.slice(1) : order.slice(0, -1).reverse();
      for (const c of seq) {
        const nb = sweep % 2 === 0 ? ups : downs;
        const list = cols.get(c)!.slice().sort((a, b) => bary(a.id, nb) - bary(b.id, nb));
        cols.set(c, list);
        rank(list);
      }
    }
  }
  const compact = d.entities.some((e) => e.compact);
  const w = compact ? ERD_SIZE.compactWidth : ERD_SIZE.width;
  const gapX = compact ? ERD_SIZE.compactGapX : ERD_SIZE.gapX;
  const gapY = compact ? ERD_SIZE.compactGapY : ERD_SIZE.gapY;
  const heights = order.map((c) => cols.get(c)!.reduce((a, e) => a + entityHeight(e) + gapY, -gapY));
  const tallest = Math.max(...heights);
  const boxes = new Map<string, Box>();
  order.forEach((c, i) => {
    let y = (tallest - heights[i]) / 2;
    for (const e of cols.get(c)!) {
      const h = entityHeight(e);
      boxes.set(e.id, { x: c * (w + gapX), y, w, h });
      y += h + gapY;
    }
  });
  return boxes;
}

/** Y of the row for a key column (or the box middle). */
export function anchorY(e: ErdEntity, b: Box, c?: string): number {
  const i = c ? e.keys.findIndex((k) => k.c === c) : -1;
  if (i < 0 || e.compact) return b.y + b.h / 2;
  return b.y + ERD_SIZE.header + i * ERD_SIZE.row + ERD_SIZE.row / 2;
}
