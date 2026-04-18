# grome-connect

CLI that bidirectionally links projects so AI agents can share context across repos.

When you link two projects, `grome` scans each for routes, types, and schemas, and writes a shared-context snapshot into every linked project's `.grome/memory/` directory. Agents running in any linked project see the shape of the others — endpoints, types, schemas — without you pasting context between chats.

## Install

```bash
npm i -g grome-connect
```

> **Package vs command name.** The npm package is `grome-connect`, but the binary installed on your `PATH` is called `grome`. So you install `grome-connect` once and then run `grome init`, `grome link`, `grome sync`, etc. The package name was rejected as `grome` on npm (too similar to existing packages), so we kept the command short and scoped the package.

## Quickstart

```bash
# In project A
grome init
grome link ../project-b

# Scan + propagate context to all linked projects
grome sync

# See current connections and memory freshness
grome status
```

After `sync`, each linked project gets:

- `.grome/memory/route-map.json` — cross-project API endpoints
- `.grome/memory/shared-types.json` — shared TypeScript types
- `.grome/memory/api-schemas.json` — validation schemas
- `.grome/memory/project-manifest.json` — who's linked, when last synced
- A "Connected Workspaces" block injected into `CLAUDE.md`, `.cursorrules`, `AGENTS.md`, and other agent config files

## Commands

| Command | Purpose |
|---|---|
| `grome init` | Create `.grome/` in the current project. |
| `grome link <path>` | Bidirectionally link two projects. |
| `grome unlink <path>` | Remove a link. |
| `grome sync` | Propagate threads and (if source changed) re-extract shared memory. |
| `grome sync-full` | Force a full rescan — ignore sync index, rebuild all memory. |
| `grome status` | Show connections, memory stats, and sync freshness. |
| `grome watch` | Auto-sync on file changes. |

## Threads — cross-project agent messaging

Threads are how an agent in one linked project talks to agents in the others: proposals, questions, FYIs, multi-turn discussions. One primitive, one file shape, one index.

Threads live in `.grome/threads/`. Each thread is a single markdown file; agents **append** messages over time, never edit past ones. `grome sync` distributes new thread files and replies to every linked peer.

```markdown
# Thread: <subject>

**From:** project-a
**To:** project-b          # or `all`, or comma-separated list
**Started:** <ISO timestamp>
**Status:** open

---

## project-a @ <ISO timestamp>

<Opening message — be specific. File paths, function names, endpoints.>

- [ ] <Action item for the receiver, if any>

## project-b @ <ISO timestamp>

<Reply. Flip checklist items above if done.>

---

**Resolution:** <one-line summary>   # added when closing
**Resolved by:** <project> @ <ISO timestamp>
```

Each project gets an auto-generated `.grome/threads/_index.md` listing every thread in the workspace (From / To / Status / Last speaker), so an agent can pick up cold without opening files blindly.

Start a thread by creating `.grome/threads/<YYYY-MM-DD-HHMM>-<slug>.md` using the template above and running `grome sync`. Reply by appending a new `## <your project> @ <timestamp>` block to an existing file and syncing again.

## Sessions — project-local handoffs

Separate from threads. A **session note** is an internal handoff for the *next agent that opens this same workspace* — useful before a context reset, compaction, or end of a long session.

- Live in `.grome/sessions/<YYYY-MM-DD-HHMM>-<slug>.md`
- **Never** synced to linked projects (unlike threads)
- Capture: what shipped, files changed, what's open, what to do first next session

## Structured data in threads and sessions

When a thread or session carries genuinely tabular data — task boards, version matrices, infra maps, migration checklists — there's an optional parseable convention:

- **YAML frontmatter with a `kind:` discriminator** (free-form kebab-case, e.g. `kind: task-board`)
- **`## section:<id>`** in sessions, or **`### section:<id>`** inside a thread turn (because `##` is reserved for turn headers there)
- **Typed markdown tables** — first column as a stable `id` when per-row state needs tracking, optional otherwise

```markdown
---
kind: task-board
generated: 2026-04-18T12:00Z
---

## section:tasks

| id | task | priority | status |
|----|------|----------|--------|
| T1 | ...  | critical | in_progress |
```

Compatible readers (Grome IDE v1.2.1+) render a `kind` pill above the document and give each `section:<id>` heading an anchor + subtle marker so structured blocks are visually distinct from prose. Plain markdown readers see ordinary tables and headings — the format is human-legible either way.

Opt in only when the content already wants to be a table. Prose threads and short session notes don't need this at all. Full protocol in `.grome/grome.md` after `grome init`.

## What gets synced vs. kept local

Shared to linked peers:
- Everything under `.grome/memory/`
- Everything under `.grome/threads/` (the thread files and auto-generated indexes)

Project-local only (never synced):
- `.grome/sessions/`
- `.grome/hook-events.jsonl`

Secrets are scrubbed by `SecretScanner` before any write.

## Development

```bash
npm install
npm run build      # tsup → dist/
npm run typecheck
npm test
```

## License

MIT © Ronald Lee
