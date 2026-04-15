import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConnectionManager } from './ConnectionManager.js';
import { detectFramework } from '../extractors/detection.js';

const START_MARKER = '<!-- grome:start -->';
const END_MARKER = '<!-- grome:end -->';

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

/**
 * Build a project-specific injection block with actual connection details.
 */
export function buildInjection(projectRoot: string): string {
  const connections = ConnectionManager.readConnections(projectRoot);
  const projectName = ConnectionManager.getProjectName(projectRoot);

  if (connections.connections.length === 0) {
    return '';
  }

  // Threads is opt-out (default true). When false, the Threads section
  // is omitted entirely — agents in this project should have no reason
  // to know threads exist.
  let enableThreads = true;
  try {
    const config = ConnectionManager.readConfig(projectRoot);
    enableThreads = config.enableThreads !== false;
  } catch { /* default true */ }

  // Build project list with frameworks
  const projectLines = connections.connections.map(conn => {
    let framework = '';
    try {
      const fw = detectFramework(conn.path);
      if (fw) framework = ` (${fw})`;
    } catch { /* can't detect */ }
    const name = conn.name || conn.path.split('/').pop();
    return `- **${name}**${framework} — \`${conn.path}\``;
  }).join('\n');

  const peerExample = connections.connections[0]?.name ?? 'other-project';

  return `${START_MARKER}
## Connected Workspaces (Grome Connect)

This project (**${projectName}**) is linked to:
${projectLines}

### Shared Context Files

Cross-project context is in \`.grome/memory/\`. **Read these files when working across projects:**

| File | When to read |
|------|-------------|
| \`route-map.json\` | Making API calls, fetch requests, or referencing endpoints from connected projects |
| \`shared-types.json\` | Importing types, defining interfaces, or matching request/response shapes |
| \`api-schemas.json\` | Writing validation schemas that must match a connected project's data model |
| \`project-manifest.json\` | Checking which projects are connected and when context was last synced |

${enableThreads ? `### Threads (cross-project messaging)

A **thread** is the single primitive for anything an agent in one project wants to communicate to agents in connected projects — announcements with action items, questions, FYIs, multi-turn discussions. They all use the same file shape, live in the same directory, and show up in the same index.

Threads live in \`.grome/threads/\`. Each thread is one markdown file. Agents append messages over time; nothing is ever edited after it's posted.

**Check \`_index.md\` first.** It is auto-generated per project and lists **every** thread in the workspace — not just the ones addressed to you. Columns: Thread, From, To, Status, Progress, Last speaker. You filter mentally via the **To** column: rows with \`${projectName}\` or \`all\` are yours; others are informational (you may read them, but the action isn't on you). Do not open individual thread files blindly — read the index, pick the rows that matter, then open those.

**When to read:** on demand — when the user asks things like "catch me up", "is there anything from \`${peerExample}\`", "what did the other team say", "read the latest thread", or similar. Not automatically on every prompt.

**When the user refers to "the thread" or "what they said" ambiguously**, do not guess. Read \`_index.md\`, list the matching open threads back to the user (title + last-speaker + status), and ask which one they mean before opening any file.

**Starting a thread:** create \`.grome/threads/<YYYY-MM-DD-HHMM>-<slug>.md\` using the template below. Use the \`To\` field to address a specific project, a comma-separated list, or \`all\`. Include a checklist when there are concrete action items; omit it when it's a question or FYI. Run \`npx grome-connect sync\` to distribute (or \`grome sync\` if the CLI is globally installed).

**Replying:** open the thread file and append a new \`## <your project> @ <ISO timestamp>\` section at the bottom. If someone added checklist items that you've completed, flip \`[ ]\` to \`[x]\` in-place. Run \`npx grome-connect sync\` to propagate back (or \`grome sync\` if the CLI is globally installed).

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
` : ''}
### Sessions / new-session handoffs (this project only)

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

### Hook events (IDE-only)

If \`.grome/hook-events.jsonl\` exists, it's an append-only log written by the Grome IDE's Claude Code hooks. It's **project-local**, never synced, and only relevant for debugging the hook pipeline itself. Do not read it unless the user explicitly asks (e.g. "why didn't the hook fire", "look at the hook events").

### Rules

1. If memory files are stale (check \`generatedAt\`), tell the user to run \`npx grome-connect sync\` (or \`grome sync\` if the CLI is globally installed).
2. **NEVER include secret values** in handoffs, sessions, or .grome/ files. Use env var names only.
3. After making changes that affect connected projects, proactively suggest creating a handoff.
4. \`.grome/sessions/\` and \`.grome/hook-events.jsonl\` are project-local and never synced across connected projects.
${END_MARKER}`;
}

export class AgentConfigInjector {
  /**
   * Inject/update the grome section in agent config files.
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
   * Remove the grome section from all agent config files.
   * Returns list of files that were updated.
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
