

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

### Threads (cross-project messaging)

A **thread** is the single primitive for anything an agent in one project wants to communicate to agents in connected projects — announcements with action items, questions, FYIs, multi-turn discussions. They all use the same file shape, live in the same directory, and show up in the same index.

Threads live in `.grome/threads/`. Each thread is one markdown file. Agents append messages over time; nothing is ever edited after it's posted.

**Check `_index.md` first.** It is auto-generated per project and lists only threads addressed to **this** project (`grome-connect`) — either directly by name or addressed to `all`. Columns: Thread, From, To, Status, Progress, Last speaker. Do not read every file in the threads directory; read only what the index points to.

**When to read:** on demand — when the user asks things like "catch me up", "is there anything from `grome`", "what did the other team say", "read the latest thread", or similar. Not automatically on every prompt.

**When the user refers to "the thread" or "what they said" ambiguously**, do not guess. Read `_index.md`, list the matching open threads back to the user (title + last-speaker + status), and ask which one they mean before opening any file.

**Starting a thread:** create `.grome/threads/<YYYY-MM-DD-HHMM>-<slug>.md` using the template below. Use the `To` field to address a specific project, a comma-separated list, or `all`. Include a checklist when there are concrete action items; omit it when it's a question or FYI. Run `grome sync` to distribute.

**Replying:** open the thread file and append a new `## <your project> @ <ISO timestamp>` section at the bottom. If someone added checklist items that you've completed, flip `[ ]` to `[x]` in-place. Run `grome sync` to propagate back.

**Resolving:** when the thread is settled, any participant appends a resolution footer and changes the header's `**Status:**` line to `resolved`.

Thread file format (`.grome/threads/<YYYY-MM-DD-HHMM>-<slug>.md`):

```markdown
# Thread: <clear subject or question>

**From:** grome-connect
**To:** grome
**Started:** <ISO timestamp>
**Status:** open

---

## grome-connect @ <ISO timestamp>

<Your opening message. Be specific — include file paths, endpoint names,
type names. Write for an agent that has zero context on your recent work.>

If there are concrete things the receiver needs to do, list them as a
checklist. Omit this block entirely for questions or FYIs.

- [ ] <Specific action item for the receiver>
- [ ] <Another action>

## <other project> @ <ISO timestamp>

<Reply. Flip checklist items above if you've done them.>

---

**Resolution:** <one-line summary> (only when closing)
**Resolved by:** <project> @ <ISO timestamp>
```

**Principles:**
1. Write for an agent with **zero context** about the sender's recent work.
2. Be **specific** — file paths, function names, endpoint URLs, type names.
3. Use a **checklist** when there's concrete work to be done; skip it when it's a question or FYI.
4. **NEVER include secret values** — env var names only.
5. Don't open parallel threads on the same topic; join the existing one.

**The user may simply say "write a handoff about X", "hand this off to the backend", "let grome know about this", "start a conversation with <project>", or "ask <project> Y".** These all mean: write a thread. The user does not need to know the file format or the word "thread" — just interpret their intent, pick an appropriate **To**, include a checklist if there's work involved, and write the opening message.

**Proactively suggest a thread** after making changes to API routes, shared types, schemas, or anything connected projects depend on. Say something like: "I made changes that affect `grome`. Want me to open a thread so their agent knows?"

### Sessions / new-session handoffs (this project only)

A **session note** (a.k.a. **new-session handoff**) is an *internal* handoff for the next agent that opens this same workspace — distinct from cross-project threads in `.grome/threads/`. They contain **everything the next agent needs** to pick up cleanly when the current context is about to be lost (compaction, IDE reset, end of a long session). Sessions are NOT synced across projects — use threads for that.

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
