# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-04-15

### Fixed
- Solo-connect / zero-peer projects now correctly write `.grome/grome.md` and the pointer block. `AgentConfigInjector.inject()` and `writeGromeMd()` previously short-circuited on `connections.length === 0`, leaving a freshly-initialized project with neither the spec file nor any agent-file pointer — the IDE's first-time connect flow hit this. Gate is now "project is grome-initialized," not "has at least one peer." Pointer and grome.md render a "none yet" placeholder for the Connected projects line until a peer is linked.

## [0.3.0] - 2026-04-15

### Removed
- **Legacy memory snapshots.** `route-map.json`, `shared-types.json`, `api-schemas.json`, and the generated memory `README.md` are no longer produced. `grome sync` now unlinks them on sight in every connected project (one-shot cleanup). Threads + live grep against connected source trees replace the snapshot-based story — a stale snapshot pointing at a removed endpoint was strictly worse than grepping current source. Agent-file guidance no longer references these files.

### Added
- **`.grome/grome.md`** — single source of truth for the grome protocol (threads, sessions, memory, rules). Regenerated wholesale on every sync; no markers, no diffing. Committed to the repo by design.
- **Pointer-style agent-file injection.** The injected block in `CLAUDE.md` / `AGENTS.md` / `.cursor/rules/grome-connect.mdc` / etc. is now ~10 lines pointing at `.grome/grome.md`, instead of ~150 lines duplicated per file. Keeps user instruction files lean; changing the protocol no longer requires rewriting every injected block. Protocol version hint (`<!-- grome-protocol: v1 -->`) included for future compatibility checks.
- **`connections[].languages`** on `project-manifest.json` — lightweight per-project language detection (TypeScript / Go / Rust / Python / Ruby / PHP / Java / Kotlin / Elixir) so agents know what to grep when resolving cross-project references. Manifest bumped to `version: 2`.
- New library exports: `buildGromeMd`, `writeGromeMd`, `detectLanguages`.

### Changed
- `MemoryWriter.sync` no longer runs extractors or the source-file dirty check — threads + manifest + agent files + grome.md are cheap enough to always write. `sync-full` retained as an alias. The `SyncResult` shape changed; `totalRoutes` / `totalTypes` / `totalSchemas` and `extractionSkipped` are gone.
- `AgentConfigInjector.inject()` always refreshes `.grome/grome.md` before touching any agent file. `AgentConfigInjector.remove()` deletes `.grome/grome.md` on full disconnect.

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
