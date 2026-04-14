

<!-- grome:start -->
## Connected Workspaces (Grome Connect)

This project (**grome-connect**) is linked to:
- **grome** — `/Volumes/RLEE-4TB/Desktop-External/grome-all/grome`
- **getgrome** (next) — `/Volumes/RLEE-4TB/Desktop-External/grome-all/getgrome`

### Shared Context Files

Cross-project context is in `.grome/memory/`. **Read these files when working across projects:**

| File | When to read |
|------|-------------|
| `route-map.json` | Making API calls, fetch requests, or referencing endpoints from connected projects |
| `shared-types.json` | Importing types, defining interfaces, or matching request/response shapes |
| `api-schemas.json` | Writing validation schemas that must match a connected project's data model |
| `project-manifest.json` | Checking which projects are connected and when context was last synced |

### Handoffs (cross-project)

Handoffs live in `.grome/memory/handoffs/`. They are briefing documents written by agents in connected projects about changes that affect other projects.

**The index is authoritative for "is there a handoff for me?"** Open `.grome/memory/handoffs/_index.md` *first*. It is auto-generated per project and lists only handoffs addressed to **this** project (`grome-connect`) — either directly, or addressed to `all`. Do NOT read every file in the handoffs directory; read only the ones the index points to.

**When to read:** on demand — when the user asks things like "catch me up", "is there a handoff", "what did the other team change", "read the latest from `grome`", or similar. Not automatically on every prompt.

**After reading a handoff,** open its `.md` file and find the per-recipient tracking table near the bottom. Flip your project's **Read** cell from `[ ]` to `[x]`. When you've *implemented* the action items (not just read them), flip **Done** too. The index regenerates these on the next `grome sync`.

**Writing handoffs:** when the user says "write a handoff", "let `grome` know", "hand this off to `<other project>`", or similar after changes that affect connected projects, write a new `.md` to `.grome/memory/handoffs/` using the template below, then run `grome sync` to distribute it. The **To** field decides who sees it in their index — use a specific project name, a comma-separated list, or `all`.

A handoff should be a **complete briefing** that another agent can read and immediately understand what happened, why it matters, and exactly what to do. Write it as if you're handing off to a colleague who has zero context.

Handoff file format (`.grome/memory/handoffs/<YYYY-MM-DD-HHMM>-<slug>.md`):
```markdown
# Handoff: <clear title of what changed>

**From:** grome-connect
**To:** grome
**Date:** <ISO date>
**Type:** feature-complete | breaking-change | dependency-update | migration | note
**Status:** open

## What Changed

<Detailed explanation of what was changed and why. Include specific file paths,
function names, endpoint paths, type names. Be precise — the receiving agent
needs to know exactly what to look for.>

## Impact on Connected Projects

<Explain specifically how this change affects the other projects. What will break?
What needs to be updated? What new capabilities are available?>

## Action Items

- [ ] <Specific thing the receiving project needs to do>
- [ ] <Another specific action>

## Files Changed

- `src/routes/users.ts` — Added role field to response
- `src/types/user.ts` — Updated User interface

## Breaking Changes

<List any breaking changes. If none, omit this section.>

## New Environment Variables

<List any new env vars needed. Names only, NEVER values.>

## Additional Context

<Any other details that would help the receiving agent.>

## Tracking

| Project | Read | Done |
| ------- | ---- | ---- |
| grome-connect | [ ] | [ ] |
| grome | [ ] | [ ] |
| getgrome | [ ] | [ ] |
```

**Key principles for handoffs:**
1. Write for an agent that has **zero context** about your recent work
2. Be **specific** — file paths, function names, endpoint URLs, type names
3. Include **action items** — what exactly should the receiving project do
4. Explain **why** the change was made, not just what changed
5. **NEVER include secret values** — env var names only
6. Always include **To** and the **Tracking** table so the index can filter correctly

**The user may simply say "write a handoff about X" or "hand this off to the backend" or "let the frontend team know about this".** These all mean: write a handoff document. The user does not need to know the file format or mention Grome — just interpret their intent and write the briefing.

**Proactively suggest a handoff** after making changes to API routes, shared types, schemas, or anything connected projects depend on. Say something like: "I made changes to the API that affect connected projects. Want me to write a handoff so the other agents know?"

### Sessions / new-session handoffs (this project only)

A **session note** (a.k.a. **new-session handoff**) is an *internal* handoff for the next agent that opens this same workspace — distinct from cross-project handoffs in `.grome/memory/handoffs/`. They contain **everything the next agent needs** to pick up cleanly when the current context is about to be lost (compaction, IDE reset, end of a long session). Sessions are NOT synced across projects — use handoffs for that.

Session files live in `.grome/sessions/`. Two kinds:
- `history.md` — auto-generated by the Grome IDE from hook events; a rolling summary of prompts, tool usage, and file touches. (Only present if the user runs Grome IDE with hooks enabled.)
- `<YYYY-MM-DD-HHMM>-<slug>.md` — user-triggered briefing notes written by a prior agent when the user asked them to "write a session" / "leave a note for next agent" / "write a new-session".

**Do NOT read sessions automatically on every prompt.** Read them **on demand** — when the user says things like "catch me up", "where did we leave off", "read the last session", "is there a session note", "what was I working on", or similar. Prefer the most recent timestamped file; fall back to `history.md`.

**Writing a session note:** when the user says "write a session", "write a new-session", "leave a note for the next agent", "session handoff", "write up where we left off", "hand off to the next session", or similar — or proactively before a likely context loss (long session, major milestone, user mentions resetting) — write a new file to `.grome/sessions/<YYYY-MM-DD-HHMM>-<slug>.md` using this format. Self-contained, specific, and written for an agent with **zero prior context** (they cannot ask the user clarifying questions):

```markdown
# Session: <clear title of what you worked on>

**Date:** <ISO date-time>
**Build / version:** <if applicable, e.g. b132 / v1.1.2>
**Status:** <open | shipped | blocked>

## Headline

<One or two sentences: what is the state of the world right now? What's the single most important thing the next agent should know?>

## What Shipped This Session

<Numbered list of concrete things completed. Each item: what changed, why, and the key files/functions/endpoints. Be specific — the next agent should not have to grep to understand.>

## Files Changed

- `path/to/file.ts` — what changed and why
- `path/to/other.tsx` — what changed and why

## Known / Open

### Not Yet Done
<Numbered list of pending work, with enough detail the next agent can pick it up.>

### Untested / Risky
<Things that were implemented but not verified in a running build, or known edge cases.>

## Build State

<Compile status, uncommitted changes, current branch, buildNumber, anything else load-bearing for resuming work.>

## What to Do First in the Next Session

1. <First concrete action>
2. <Second concrete action>
3. <etc.>
```

Sections may be omitted when they genuinely don't apply, but the first five (Headline, What Shipped, Files Changed, Known/Open, What to Do First) should almost always be present.

### Hook events (IDE-only)

If `.grome/hook-events.jsonl` exists, it's an append-only log written by the Grome IDE's Claude Code hooks. It's **project-local**, never synced, and only relevant for debugging the hook pipeline itself. Do not read it unless the user explicitly asks (e.g. "why didn't the hook fire", "look at the hook events").

### Rules

1. If memory files are stale (check `generatedAt`), tell the user to run `grome sync`.
2. **NEVER include secret values** in handoffs, sessions, or .grome/ files. Use env var names only.
3. After making changes that affect connected projects, proactively suggest creating a handoff.
4. `.grome/sessions/` and `.grome/hook-events.jsonl` are project-local and never synced across connected projects.
<!-- grome:end -->
