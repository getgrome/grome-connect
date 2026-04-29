import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConnectionManager } from './ConnectionManager.js';
import { detectFramework } from '../extractors/detection.js';

const START_MARKER = '<!-- grome:start -->';
const END_MARKER = '<!-- grome:end -->';
const GROME_PROTOCOL_VERSION = 'v1';

// All known agent config files. The key is also the short `--agents=<name>` alias.
export const AGENT_CONFIGS: Array<{ alias: string; file: string; label: string }> = [
  { alias: 'claude',   file: 'CLAUDE.md',                        label: 'Claude Code' },
  { alias: 'cursor',   file: '.cursor/rules/grome-connect.mdc',  label: 'Cursor' },
  { alias: 'cursor-legacy', file: '.cursorrules',                label: 'Cursor (legacy)' },
  { alias: 'windsurf', file: '.windsurfrules',                   label: 'Windsurf' },
  { alias: 'cline',    file: '.clinerules',                      label: 'Cline' },
  { alias: 'agents',   file: 'AGENTS.md',                        label: 'Generic (AGENTS.md)' },
  { alias: 'copilot',  file: '.github/copilot-instructions.md',  label: 'GitHub Copilot' },
  { alias: 'aider',    file: 'CONVENTIONS.md',                   label: 'Aider' },
  { alias: 'codex',    file: 'codex.md',                         label: 'OpenAI Codex' },
  { alias: 'zed',      file: '.rules',                           label: 'Zed' },
];

const AGENT_CONFIG_FILES = AGENT_CONFIGS.map(c => c.file);

export function resolveAgents(aliasesOrFiles: string[]): string[] {
  const out = new Set<string>();
  for (const raw of aliasesOrFiles) {
    const a = raw.trim();
    if (!a) continue;
    const match = AGENT_CONFIGS.find(c => c.alias === a || c.file === a);
    if (match) out.add(match.file);
  }
  return [...out];
}

export interface DetectResult {
  detected: string[];    // files that already exist
  available: string[];   // all known files (AGENT_CONFIG_FILES)
}

export function detectAgentConfigs(projectRoot: string): DetectResult {
  const detected: string[] = [];
  for (const filename of AGENT_CONFIG_FILES) {
    if (fs.existsSync(path.join(projectRoot, filename))) detected.push(filename);
  }
  return { detected, available: [...AGENT_CONFIG_FILES] };
}

interface ProjectContext {
  projectName: string;
  peerList: string;       // "- **foo** (next.js) — `/path`\n- **bar** — `/path`"
  peerNamesCsv: string;   // "foo, bar"
  peerExample: string;    // first peer name, or "other-project"
  enableThreads: boolean;
}

function readProjectContext(projectRoot: string): ProjectContext | null {
  // Returns null only if the project isn't grome-initialized at all. A
  // grome-initialized project with zero peers still gets grome.md + a
  // pointer — a solo connect is a valid state during first-time setup,
  // and the protocol doc is useful regardless of peer count.
  if (!ConnectionManager.isInitialized(projectRoot)) return null;

  const connections = ConnectionManager.readConnections(projectRoot);
  const projectName = ConnectionManager.getProjectName(projectRoot);

  let enableThreads = true;
  try {
    const config = ConnectionManager.readConfig(projectRoot);
    enableThreads = config.enableThreads !== false;
  } catch { /* default true */ }

  const peerList = connections.connections.length === 0
    ? '_(no peers connected yet)_'
    : connections.connections.map(conn => {
        let framework = '';
        try {
          const fw = detectFramework(conn.path);
          if (fw) framework = ` (${fw})`;
        } catch { /* can't detect */ }
        const name = conn.name || conn.path.split('/').pop();
        return `- **${name}**${framework} — \`${conn.path}\``;
      }).join('\n');

  const peerNamesCsv = connections.connections.length === 0
    ? '_(none yet — connect a peer with `grome connect <path>`)_'
    : connections.connections.map(c => c.name || c.path.split('/').pop()).join(', ');

  const peerExample = connections.connections[0]?.name ?? 'other-project';

  return { projectName, peerList, peerNamesCsv, peerExample, enableThreads };
}

/**
 * Build the tiny pointer block that gets injected into each agent config
 * file. Instead of duplicating the full protocol, agents are directed to
 * read `.grome/grome.md` (the single source of truth, regenerated on every
 * sync). The `Connected projects:` line is kept inline so the common
 * "who's in this workspace" question doesn't require a second file read.
 */
export function buildInjection(projectRoot: string): string {
  const ctx = readProjectContext(projectRoot);
  if (!ctx) return '';

  return `${START_MARKER}
## Grome Connect

This project (**${ctx.projectName}**) is part of a connected Grome workspace.

**CRITICAL:** Before replying to threads, writing session notes, running \`sync\`, or referencing connected projects, read \`.grome/grome.md\` in full. It contains the protocol for threads, sessions, memory files, and cross-project conventions — treat it as load-bearing instructions.

Connected projects: ${ctx.peerNamesCsv}. See \`.grome/memory/project-manifest.json\` for paths.

<!-- grome-protocol: ${GROME_PROTOCOL_VERSION} -->
${END_MARKER}`;
}

/**
 * Build the full grome protocol spec — written once to `.grome/grome.md`
 * and pointed at from each agent config file. This is the long-form
 * document that used to be duplicated into every agent file.
 */
export function buildGromeMd(projectRoot: string): string {
  const ctx = readProjectContext(projectRoot);
  if (!ctx) return '';

  const { projectName, peerList, peerExample, enableThreads } = ctx;

  return `# Grome Connect Protocol

> Auto-generated by \`npx grome-connect sync\`. Do not edit — your changes will be overwritten.
> Protocol version: ${GROME_PROTOCOL_VERSION}

> **Canonical CLI invocation:** \`npx grome-connect <command>\` (e.g. \`npx grome-connect sync\`). If the user has globally installed the CLI (\`npm i -g grome-connect\`), the shortcut \`grome <command>\` also works. Every other sync / thread / connect instruction in this document uses the canonical form — that's the one to run.

## Connected Workspaces

This project (**${projectName}**) is linked to:
${peerList}

### Memory

\`.grome/memory/project-manifest.json\` is the only memory file. It lists every connected project with its root path, detected framework, and detected languages. **When you need endpoint paths, type shapes, schemas, or any API detail from a connected project, open the manifest to resolve the project's root, then grep / read that project's source directly.** Live source beats any snapshot.

${enableThreads ? `### Threads (cross-project messaging)

A **thread** is the single primitive for anything an agent in one project wants to communicate to agents in connected projects — announcements with action items, questions, FYIs, multi-turn discussions. They all use the same file shape, live in the same directory, and show up in the same index.

Threads live in \`.grome/threads/\`. Each thread is one markdown file. Agents append messages over time; nothing is ever edited after it's posted.

**Check \`_index.md\` first.** It is auto-generated per project and lists **every** thread in the workspace — not just the ones addressed to you. Columns: Thread, From, To, Status, Progress, Last speaker. You filter mentally via the **To** column: rows with \`${projectName}\` or \`all\` are yours; others are informational (you may read them, but the action isn't on you). Do not open individual thread files blindly — read the index, pick the rows that matter, then open those.

**When to read:** on demand — when the user asks things like "catch me up", "is there anything from \`${peerExample}\`", "what did the other team say", "read the latest thread", or similar. Not automatically on every prompt.

**When the user refers to "the thread" or "what they said" ambiguously**, do not guess. Read \`_index.md\`, list the matching open threads back to the user (title + last-speaker + status), and ask which one they mean before opening any file.

**Starting a thread:** create \`.grome/threads/<YYYY-MM-DD-HHMM>-<slug>.md\` using the template below. Use the \`To\` field to address a specific project, a comma-separated list, or \`all\`. Include a checklist when there are concrete action items; omit it when it's a question or FYI. Run \`npx grome-connect sync\` to distribute.

**Replying:** open the thread file and append a new \`## <your project> @ <ISO timestamp>\` section at the bottom. If someone added checklist items that you've completed, flip \`[ ]\` to \`[x]\` in-place. Run \`npx grome-connect sync\` to propagate back.

**Resolving:** when the thread is settled, any participant appends a resolution footer and changes the header's \`**Status:**\` line to \`resolved\`.

Thread file format (\`.grome/threads/<YYYY-MM-DD-HHMM>-<slug>.md\`):

\`\`\`markdown
# Thread: <clear subject or question>

**From:** ${projectName}
**To:** ${peerExample}
**Started:** <ISO timestamp>
**Status:** open

---

## ${projectName} @ <ISO timestamp>

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
\`\`\`

**Principles:**
1. Write for an agent with **zero context** about the sender's recent work.
2. Be **specific** — file paths, function names, endpoint URLs, type names.
3. Use a **checklist** when there's concrete work to be done; skip it when it's a question or FYI.
4. **NEVER include secret values** — env var names only.
5. Don't open parallel threads on the same topic; join the existing one.

**The user may simply say "write a handoff about X", "hand this off to the backend", "let ${peerExample} know about this", "start a conversation with <project>", or "ask <project> Y".** These all mean: write a thread. The user does not need to know the file format or the word "thread" — just interpret their intent, pick an appropriate **To**, include a checklist if there's work involved, and write the opening message.

**Proactively suggest a thread** after making changes to API routes, shared types, schemas, or anything connected projects depend on. Say something like: "I made changes that affect \`${peerExample}\`. Want me to open a thread so their agent knows?"

#### Intra-workspace multi-agent chat (same project, multiple agents)

Threads aren't just for cross-project communication. When multiple agents are working in *this* same workspace — e.g. Claude in one terminal, Codex in another, Gemini in a third, or the Grome IDE plus a side CLI agent — **use a thread addressed to this project itself** as the multi-agent communication primitive:

\`\`\`markdown
# Thread: <subject>

**From:** ${projectName}
**To:** ${projectName}        # or "all" — either works for intra-workspace
**Status:** open

---

## ${projectName} @ <ISO timestamp> [claude]

<Opening message from Claude.>

## ${projectName} @ <ISO timestamp> [codex]

<Reply from Codex.>
\`\`\`

Why threads and not sessions: threads have multi-turn append baked in, an index, resolution semantics, and the \`grome watch\` notification pipeline. Sessions are one-shot handoff documents — they're the right primitive when one agent is finishing up and the *next* agent (after compaction / restart) needs to pick up, but they're not built for live back-and-forth.

The \`[<agent>]\` author tag on turn headers disambiguates which harness posted each turn, which matters when every turn's \`From:\`/author-project is the same workspace. Use it for intra-workspace threads; optional for cross-project.

When an agent in the workspace sees a \`new-turn\` event on a self-addressed thread, the same flow documented under **Live notifications** applies — surface to the user, wait for permission, etc. The auto-reply exception applies here too.

` : ''}### Sessions / new-session handoffs (this project only)

A **session note** (a.k.a. **new-session handoff**) is an *internal* handoff for the next agent that opens this same workspace — distinct from cross-project threads in \`.grome/threads/\`. They contain **everything the next agent needs** to pick up cleanly when the current context is about to be lost (compaction, IDE reset, end of a long session). Sessions are NOT synced across projects — use threads for that.

Session files live in \`.grome/sessions/\`. Two kinds:
- \`history.md\` — auto-generated by the Grome IDE from hook events; a rolling summary of prompts, tool usage, and file touches. (Only present if the user runs Grome IDE with hooks enabled.)
- \`<YYYY-MM-DD-HHMM>-<slug>.md\` — user-triggered briefing notes written by a prior agent when the user asked them to "write a session" / "leave a note for next agent" / "write a new-session".

**Do NOT read sessions automatically on every prompt.** Read them **on demand** — when the user says things like "catch me up", "where did we leave off", "read the last session", "is there a session note", "what was I working on", or similar. Prefer the most recent timestamped file; fall back to \`history.md\`.

**Writing a session note:** when the user says "write a session", "write a new-session", "leave a note for the next agent", "session handoff", "write up where we left off", "hand off to the next session", or similar — or proactively before a likely context loss (long session, major milestone, user mentions resetting) — write a new file to \`.grome/sessions/<YYYY-MM-DD-HHMM>-<slug>.md\` using this format. Self-contained, specific, and written for an agent with **zero prior context** (they cannot ask the user clarifying questions):

\`\`\`markdown
# Session: <clear title of what you worked on>

**Date:** <ISO date-time>
**Build / version:** <if applicable, e.g. b132 / v1.1.2>
**Status:** <open | shipped | blocked>

## Headline

<One or two sentences: what is the state of the world right now? What's the single most important thing the next agent should know?>

## What Shipped This Session

<Numbered list of concrete things completed. Each item: what changed, why, and the key files/functions/endpoints. Be specific — the next agent should not have to grep to understand.>

## Files Changed

- \`path/to/file.ts\` — what changed and why
- \`path/to/other.tsx\` — what changed and why

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
\`\`\`

Sections may be omitted when they genuinely don't apply, but the first five (Headline, What Shipped, Files Changed, Known/Open, What to Do First) should almost always be present.

### Structured data in threads and sessions

When a thread turn or session carries genuinely **tabular data** — a task board, a version matrix, an infra map, a benchmark comparison, a migration checklist — use this shared convention so the Grome IDE (v1.2.1+) and any downstream tooling can parse it consistently. Prose-style threads and short sessions don't need this; only reach for it when the content already wants to be a table.

Three pieces:

1. **YAML frontmatter with \`kind:\`** (the discriminator). Kebab-case, free-form — pick something descriptive. The IDE renders a small pill above the document when it sees this, signaling "this is structured":

   \`\`\`yaml
   ---
   kind: retrieval-version-snapshot
   generated: <ISO timestamp>
   ---
   \`\`\`

2. **\`## section:<id>\` headers** (in sessions) or **\`### section:<id>\`** inside a thread turn — because \`##\` is already reserved for turn headers (\`## <project> @ <ts>\`) in threads. Stable, machine-addressable ids in snake_case: \`section:versions\`, \`section:tasks\`, \`section:infra\`. Matched case-insensitively. Section ids are **optional** — the \`kind:\` discriminator alone is enough to mark the document as parseable; section ids give finer-grained extraction when you want it.

3. **Typed markdown tables.** Every row is a record, every column a field. No schema — tables are self-describing by their header row. When the IDE needs to track per-row state (e.g. a task changing \`not_started\` → \`in_progress\`), make the **first column a stable \`id\`** (\`T1\`, \`v31\`, etc.) that persists across edits. Reference tables (inventory-style, no mutation) can skip the \`id\` column.

Minimal example of a session:

\`\`\`markdown
---
kind: task-board
generated: 2026-04-17T16:35:00Z
---

# <title>

## section:tasks

| id | task | priority | status | blocked_by |
|----|------|----------|--------|------------|
| T1 | Wire RETRIEVAL_V31 into analyze/route.ts | critical | in_progress | — |
| T2 | Smoke-test v31 end-to-end | critical | not_started | T1 |
\`\`\`

Rules:
- **Apply only when it fits.** A two-sentence session doesn't need frontmatter. Don't contort prose into tables just to use the convention.
- **Thread turn headers own \`##\`.** Inside a thread turn body, always use \`###\` for section headings so the turn-detection parser isn't confused.
- **Don't use \`section:\` in a heading that isn't actually a structured section** — that pollutes extraction.

### Live notifications (\`grome watch\`)

When multiple agents work in the same workspace (IDE + side terminal, or two CLI agents), \`grome watch\` is the channel that tells each of them when a peer has posted a new thread turn or session file. Without it, the only way to notice peer activity is for the user to ask.

**Start it at session start.** If you support background shell tasks, start \`npx grome-connect watch\` as a backgrounded task once and leave it running. The command prints one line per genuinely-new event to stdout and appends the same events to \`.grome/.runtime/inbox.jsonl\` for durability. Event format:

\`\`\`
[new-thread]  .grome/threads/<file>.md — from <project>   # file appeared for the first time
[new-turn]    .grome/threads/<file>.md — from <project>   # new ## <project> @ <ts> block appended
[new-session] .grome/sessions/<file>.md — from <project>  # session file appeared
\`\`\`

**When you see an event in your background-task output, follow this exact flow:**

1. **Do not auto-read the file.** The event is attention, not authorization. Reading a thread costs the user nothing, but the agent should still confirm intent before acting — some threads are not meant for this project even when they land in the inbox.
2. **Surface it to the user in your very next turn**, concisely. Template: _"\`<project>\` just posted a \`<kind>\` in \`<path>\` — want me to read it and reply?"_ Use the \`from\` field from the event, not a guess.
3. **Wait for the user's answer.** If yes → read the file with the Read tool, summarize what the sender is asking, and draft a reply turn following the Threads protocol above (append \`## ${projectName} @ <ISO timestamp>\` at the bottom, flip any checklist items you've done, run \`npx grome-connect sync\` to propagate). If no / "just read it" → read and summarize but do **not** draft a reply. If the user is ambiguous, ask.
4. **Never reply without the user's explicit go-ahead.** Even if the event is clearly addressed to this project and the ask is obvious, the default is: you surface, the user decides. The \`To:\` field, checklist items, and urgency of the thread are all **signals for your recommendation**, not triggers to act.

   **Exception — user-granted auto-reply.** If the user has explicitly delegated — "auto-reply to anything from \`<project>\`", "just respond to incoming threads while I'm afk", "go ahead and handle any new turns that come in" — you may draft and append replies without asking for each one. Rules:
   - **Scope narrowly.** "Auto-reply" alone means *threads matching the context the user just discussed* (same sender, same topic). Only broaden to all incoming threads when the user says "all" or equivalent.
   - **Session-scoped.** Authorization does not survive across sessions. Ask again next session.
   - **Fall back to asking on ambiguity.** If a thread isn't clearly addressed to this project (\`To:\` doesn't include \`${projectName}\` or \`all\`), the ask is unclear, the thread touches something outside the user's stated scope, or replying would require a decision the user hasn't delegated — surface it normally instead of auto-replying.
   - **Summarize what you did.** When you auto-reply, tell the user in your next surface turn ("replied to the new turn from \`<project>\` in \`<path>\` — summary: …") so they can audit without opening the thread.
   - **Sessions are a separate flow.** Auto-reply does not apply to sessions (they're not reply-able). Sessions have their own auto-*act* authorization described below; the two authorizations are independent.
5. **If a new event arrives while you're mid-turn**, finish what you're doing first, then mention it at the end of your response. Don't interrupt the user's current task to surface the event.
6. **Multiple events in a row** — group them in one surface-to-user turn rather than interrupting per event. E.g. _"Two new turns arrived — one from \`<a>\` in \`<path1>\`, one from \`<b>\` in \`<path2>\`. Want me to catch you up?"_

**Sessions are handoff instructions, not messages.** A \`[new-session]\` event means the previous agent in this workspace wrote a handoff note for whoever picks up next. Sessions are one-shot documents (no turn-append protocol), not a live communication channel — for concurrent multi-agent communication within a workspace, use **threads addressed to this project itself** (see "Intra-workspace multi-agent chat" above). Sessions ARE action-able though — the whole point of the "What to Do First" section is that the next agent executes it.

Flow for session events:

1. **Surface**: _"\`<project>\` wrote a new session note at \`<path>\` — want me to read it and pick up where they left off?"_
2. **On yes**: read the session, summarize the headline + status + immediate next steps, then **ask before executing** unless the user has granted auto-act authorization (see below). Do not start running "What to Do First" items unprompted.
3. **On no / "just read it"**: read and summarize, but don't execute.
4. **Exception — user-granted auto-act.** If the user has explicitly delegated ("pick up from the last session", "just do what the handoff says", "continue from where the other agent left off"), execute the session's "What to Do First" items in order without asking per-item. Guardrails:
   - **Session-scoped authorization** — expires at session end, just like auto-reply.
   - **Stop at blockers.** Any item that requires a decision the user hasn't delegated (destructive action, spending, publishing, irreversible change) — pause and surface before proceeding.
   - **Summarize as you go.** After each major step, brief the user on what you did so they can interrupt if you're off track.
   - **Fall back to asking on ambiguity.** If the handoff is unclear, conflicts with current state, or references things that no longer exist — stop and surface rather than guess.
5. **Don't try to reply to the session.** If you have something to say to the author, either tell the current user or write your own session note for *them* to read next time. Session files themselves are append-never-edit by the author who wrote them.

**Coordination.** Only one real watcher runs per workspace; a second \`grome watch\` invocation detects the live pid and tails the inbox instead, so it's safe for every agent to run the command. Use \`--poll\` for network / external drives; \`--force\` to take over a stale watcher.

**Optional author tag.** When appending a turn, you may add an \`[<agent>]\` suffix to the header line — e.g. \`## ${projectName} @ <ISO timestamp> [claude]\`. This is purely a routing hint for IDE consumers that want to badge a specific pane; it has no effect on protocol behavior and is safe to omit.

### Hook events (IDE-only)

If \`.grome/hook-events.jsonl\` exists, it's an append-only log written by the Grome IDE's Claude Code hooks. It's **project-local**, never synced, and only relevant for debugging the hook pipeline itself. Do not read it unless the user explicitly asks (e.g. "why didn't the hook fire", "look at the hook events").

### Rules

1. If memory files are stale (check \`generatedAt\`), tell the user to run \`npx grome-connect sync\`.
2. **NEVER include secret values** in handoffs, sessions, or .grome/ files. Use env var names only.
3. After making changes that affect connected projects, proactively suggest creating a handoff.
4. \`.grome/sessions/\` and \`.grome/hook-events.jsonl\` are project-local and never synced across connected projects.
5. \`.grome/.runtime/\` (watch pidfile, inbox jsonl, watch state) is project-local and never synced.
`;
}

/**
 * Write `.grome/grome.md` — the full protocol spec. Overwritten on every
 * sync; no diffing, no markers. Returns true if the file was written.
 */
export function writeGromeMd(projectRoot: string): boolean {
  const body = buildGromeMd(projectRoot);
  if (!body) return false;
  const gromeDir = ConnectionManager.getGromeDir(projectRoot);
  try {
    fs.mkdirSync(gromeDir, { recursive: true });
    fs.writeFileSync(path.join(gromeDir, 'grome.md'), body);
    return true;
  } catch {
    return false;
  }
}

export class AgentConfigInjector {
  /**
   * Inject/update the grome pointer block in agent config files, and
   * ensure `.grome/grome.md` (the long-form spec) exists.
   *
   * Default (no opts): inject into any AGENT_CONFIG_FILES that already exist.
   *   (Legacy behavior — used by `grome sync`.)
   *
   * With `targets`: restrict to the given filenames.
   * With `create: true`: create files in `targets` that don't exist, including
   *   parent directories (for paths like `.cursor/rules/grome-connect.mdc`).
   *
   * Returns `{ updated, created }` — both arrays of filenames.
   */
  static inject(
    projectRoot: string,
    opts?: { targets?: string[]; create?: boolean }
  ): { updated: string[]; created: string[] } {
    const updated: string[] = [];
    const created: string[] = [];
    const injection = buildInjection(projectRoot);

    if (!injection) return { updated, created };

    // Always refresh .grome/grome.md alongside pointer injection. The
    // pointer is useless without the spec it points at.
    writeGromeMd(projectRoot);

    const files = opts?.targets && opts.targets.length > 0
      ? opts.targets
      : AGENT_CONFIG_FILES;

    for (const filename of files) {
      const filePath = path.join(projectRoot, filename);
      const dir = path.dirname(filePath);
      const exists = fs.existsSync(filePath);
      const willCreate = !exists && opts?.create === true;

      if (!exists && !willCreate) {
        // Legacy default: auto-create copilot file only if .github/ exists.
        if (!opts?.targets && filename === '.github/copilot-instructions.md' && fs.existsSync(dir)) {
          // fall through to create
        } else {
          continue;
        }
      }

      if (!exists) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch {
          continue;
        }
      }

      let content = '';
      try {
        if (exists) content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      const newContent = AgentConfigInjector.upsertSection(content, injection);

      if (newContent !== content || !exists) {
        try {
          fs.writeFileSync(filePath, newContent);
          if (exists) updated.push(filename);
          else created.push(filename);
        } catch { /* write failed */ }
      }
    }

    return { updated, created };
  }

  /**
   * Strip the grome-connect section from a specific set of files (leaving
   * any user-authored content intact). Use this when the IDE removes a file
   * from `agentTargets` — inject() only touches files in its target list, so
   * dropped files need an explicit strip to clean up the old block.
   *
   * If a file becomes empty after stripping (we created it and it held
   * nothing else), the file is deleted rather than left as an empty shell.
   */
  static removeFrom(projectRoot: string, files: string[]): string[] {
    const updated: string[] = [];
    for (const filename of files) {
      const filePath = path.join(projectRoot, filename);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const newContent = AgentConfigInjector.removeSection(content);

      if (newContent !== content) {
        try {
          if (newContent.trim() === '') {
            fs.unlinkSync(filePath);
          } else {
            fs.writeFileSync(filePath, newContent);
          }
          updated.push(filename);
        } catch { /* write failed */ }
      }
    }
    return updated;
  }

  /**
   * Remove the grome section from all agent config files, and delete
   * `.grome/grome.md`. Used by full disconnect.
   */
  static remove(projectRoot: string): string[] {
    const updated: string[] = [];

    for (const filename of AGENT_CONFIG_FILES) {
      const filePath = path.join(projectRoot, filename);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const newContent = AgentConfigInjector.removeSection(content);

      if (newContent !== content) {
        fs.writeFileSync(filePath, newContent);
        updated.push(filename);
      }
    }

    // Drop the spec file. It's fully grome-owned so wholesale deletion is
    // safe — no user content to preserve.
    try {
      const gromeMd = path.join(ConnectionManager.getGromeDir(projectRoot), 'grome.md');
      if (fs.existsSync(gromeMd)) fs.unlinkSync(gromeMd);
    } catch { /* best-effort */ }

    return updated;
  }

  /**
   * Insert or replace the marked section in file content.
   */
  private static upsertSection(content: string, injection: string): string {
    const startIdx = content.indexOf(START_MARKER);
    const endIdx = content.indexOf(END_MARKER);

    if (startIdx !== -1 && endIdx !== -1) {
      // Replace existing section
      const before = content.slice(0, startIdx);
      const after = content.slice(endIdx + END_MARKER.length);
      return before + injection + after;
    }

    // Append new section
    if (!content) return injection + '\n';
    const separator = content.endsWith('\n') ? '\n' : '\n\n';
    return content + separator + injection + '\n';
  }

  /**
   * Remove the marked section from file content.
   */
  private static removeSection(content: string): string {
    const startIdx = content.indexOf(START_MARKER);
    const endIdx = content.indexOf(END_MARKER);

    if (startIdx === -1 || endIdx === -1) return content;

    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + END_MARKER.length);

    return (before.replace(/\n+$/, '') + after.replace(/^\n+/, '\n')).trim() + '\n';
  }
}
