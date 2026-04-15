# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.11] - 2026-04-15

### Fixed
- Injected agent instructions now recommend `npx grome-connect sync` first (with `grome sync` listed as the global-install shortcut). Previously agents in fresh workspaces would fail when the global CLI wasn't on PATH.

## [0.2.10] - 2026-04-15

### Added
- Interactive agent-instruction selection during `grome connect/link`. Detects existing files (`CLAUDE.md`, `.cursor/rules/*.mdc`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `AGENTS.md`, `.github/copilot-instructions.md`, `CONVENTIONS.md`, `codex.md`, `.rules`) and prompts before creating new ones.
- `--agents <list>` flag (`detect | all | none | claude,cursor,...`) and `-y/--yes` on `link`.
- `connect` alias for `link`.
- Persistent `agentTargets` in `.grome/config.json`; `grome sync` respects it when present.
- Programmatic API: `detectAgentConfigs()`, `resolveAgents()`, `AGENT_CONFIGS`, `AgentConfigInjector.removeFrom()`, `ConnectionManager.writeConfig()`.

### Changed
- `AgentConfigInjector.inject()` now accepts `{ targets, create }` and returns `{ updated, created }`. Default (no opts) preserves the prior "inject into detected only" behavior.
- CLI version is sourced from `package.json` instead of a hardcoded string.

## [0.1.0] - 2026-04-13

### Added
- Initial release.
- `grome init`, `link`, `unlink`, `sync`, `status`, `watch`, `handoff` commands.
- Per-framework route/type/schema extractors.
- Agent config injection for CLAUDE.md, .cursorrules, AGENTS.md, and related files.
- Secret scanning before any synced write.
