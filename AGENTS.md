# Agent instructions

This repository is **Agent Observability**: a Snowflake data mart (`sql/`, deployed by
`deploy.sh`) and a Snowflake App Runtime app (`agent-observability/`).

## Installing, upgrading or uninstalling

When the user asks to install, set up, deploy, configure, upgrade or uninstall this
project in their Snowflake account, use the **install-agent-observability** skill
(`.agents/skills/install-agent-observability/SKILL.md`). It walks them through every
setting, writes `install.conf` and runs `./deploy.sh`.

- All account-specific settings live in `install.conf` (gitignored; template in
  `install.conf.example`). Never hard-code account values in `sql/`, `deploy.sh` or
  `agent-observability/app.yml`, and never commit `install.conf`.
- SQL files take settings as Snowflake CLI template variables (`<% admin_role %>`,
  `<% pipeline_warehouse %>`, `<% app_database %>`, …), which `deploy.sh` supplies.
  Run them through `deploy.sh`, not directly.
- `deploy.sh` fills `agent-observability/app.yml` from `install.conf` only for the
  duration of `--app` and restores it afterwards.

## Working on the code

See `README.md` for the architecture and `agent-observability/AGENTS.md` for the app.
