import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWrite, ensureDir } from '../utils.js';

/**
 * Writes `.claude/skills/grome-workspace.md` (and parity files for other
 * harnesses if/when they support skill-style frontmatter) into a project
 * root. Same sentinel/never-clobber semantics as McpRegistrar: a managed
 * file carries a sentinel comment line, and we only refresh / remove
 * files that carry it. User-authored files in the same path are left
 * alone.
 */

const MANAGED_SENTINEL = '<!-- grome-managed: do not edit; managed by grome-connect sync -->';

export interface SkillSlot {
  /** Repo-relative path. */
  relPath: string;
  /** Body builder — receives nothing (skill content is workspace-agnostic). */
  build: () => string;
}

const SKILL_SLOTS: SkillSlot[] = [
  {
    // Claude Code loads project-local skills from `.claude/skills/<name>/SKILL.md`
    // (directory layout). The flat `.claude/skills/<name>.md` shape that 0.6.0
    // shipped never loads. See https://code.claude.com/docs/en/skills.md
    relPath: '.claude/skills/grome-workspace/SKILL.md',
    build: buildClaudeSkill,
  },
];

/**
 * Files written by 0.6.0 that we now know don't load. `provision` will
 * delete them when sentinel-managed (matching the same never-clobber-
 * user-files semantics). Listed once so we can drop the migration when
 * 0.6.0 is old enough to assume nobody has it installed.
 */
const LEGACY_SKILL_RELPATHS: string[] = [
  '.claude/skills/grome-workspace.md',
];

export interface ProvisionResult {
  path: string;
  action: 'created' | 'updated' | 'unchanged' | 'skipped-user-managed';
}

export const SkillTemplate = {
  slots: SKILL_SLOTS,

  /**
   * Provision all skill slots in `projectRoot`. Returns one result per
   * slot. Idempotent: re-running is safe.
   */
  provision(projectRoot: string): ProvisionResult[] {
    const out: ProvisionResult[] = [];
    // 0.6.0 → 0.6.1 migration: remove legacy flat-file skills if we wrote
    // them. User-authored files at the same path are preserved.
    for (const rel of LEGACY_SKILL_RELPATHS) {
      const abs = path.join(projectRoot, rel);
      if (!fs.existsSync(abs)) continue;
      try {
        const raw = fs.readFileSync(abs, 'utf8');
        if (raw.includes(MANAGED_SENTINEL)) fs.unlinkSync(abs);
      } catch {
        // best-effort
      }
    }
    for (const slot of SKILL_SLOTS) {
      out.push(provisionSlot(projectRoot, slot));
    }
    return out;
  },

  /**
   * Remove managed skill files. Files without our sentinel are left
   * alone.
   */
  unprovision(projectRoot: string): Array<{ path: string; action: 'removed' | 'skipped-user-managed' | 'file-missing' }> {
    const out: Array<{ path: string; action: 'removed' | 'skipped-user-managed' | 'file-missing' }> = [];
    const allPaths = [...SKILL_SLOTS.map((s) => s.relPath), ...LEGACY_SKILL_RELPATHS];
    for (const rel of allPaths) {
      const abs = path.join(projectRoot, rel);
      if (!fs.existsSync(abs)) {
        out.push({ path: abs, action: 'file-missing' });
        continue;
      }
      const raw = fs.readFileSync(abs, 'utf8');
      if (!raw.includes(MANAGED_SENTINEL)) {
        out.push({ path: abs, action: 'skipped-user-managed' });
        continue;
      }
      try {
        fs.unlinkSync(abs);
        // Also clean up the now-empty parent directory if we own it.
        const parent = path.dirname(abs);
        if (parent.endsWith('/grome-workspace') && fs.existsSync(parent)) {
          try {
            if (fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
          } catch { /* best-effort */ }
        }
        out.push({ path: abs, action: 'removed' });
      } catch {
        // best-effort
      }
    }
    return out;
  },
};

function provisionSlot(projectRoot: string, slot: SkillSlot): ProvisionResult {
  const abs = path.join(projectRoot, slot.relPath);
  const desired = slot.build();
  const exists = fs.existsSync(abs);

  if (exists) {
    const raw = fs.readFileSync(abs, 'utf8');
    if (!raw.includes(MANAGED_SENTINEL)) {
      return { path: abs, action: 'skipped-user-managed' };
    }
    if (raw === desired) {
      return { path: abs, action: 'unchanged' };
    }
  }

  ensureDir(path.dirname(abs));
  void atomicWrite(abs, desired);
  return { path: abs, action: exists ? 'updated' : 'created' };
}

function buildClaudeSkill(): string {
  return `---
name: grome-workspace
description: Behavior contract for any Claude Code session running in a Grome workspace. Loads on session start in any directory containing .grome/grome.md; routes user-facing replies through the grome-connect MCP chat_response tool when an instance ID is bound.
---

${MANAGED_SENTINEL}

# Grome workspace skill

You are running in a **Grome workspace** — a project linked into the Grome IDE
via grome-connect. The user may be talking to you through the Grome IDE's
dashboard chat panel, *not* the raw terminal. This skill is the contract for
how to behave when that's the case.

The workspace root is the current working directory. Peer projects (other
codebases the user has linked) are listed in
\`.grome/memory/project-manifest.json\`. The full thread / session / sync
protocol is in \`.grome/grome.md\` — read it on demand when a thread, session,
or watch event comes up.

## Detecting whether the chat panel is in use

The grome-connect MCP server is available in this workspace whenever
\`.mcp.json\` registers it (it's wired in by \`grome-connect sync\`). The chat
panel is the *user-facing* surface only when this session has a bound
\`terminalInstanceId\`:

- If \`GROME_TERMINAL_INSTANCE_ID\` is set in the environment, the IDE has
  bound this terminal to a chat panel. **Use chat_response for substantive
  replies.**
- If \`GROME_TERMINAL_INSTANCE_ID\` is unset, this is a plain terminal session
  with the MCP available for thread / session work, but no chat panel.
  Reply through stdout normally.

**Do NOT call \`grome__register_session\` with a guessed terminal ID.** The
old behavior of falling back to \`"1"\` silently routes every other pane's
replies to terminal 1's chat log. If the env var is unset, the binding stays
unset, and \`grome__chat_response\` will throw a clear error if anything
tries to use it. That's the right failure mode — surface it to the user as
"the IDE didn't inject the terminal ID; chat panel routing is unavailable
for this session."

## On every user prompt (when chat panel is bound)

1. **Load prior context.** Call \`grome__read_chat_log\` (no arguments). It
   returns \`{ header, turns: [{ role, body, ts }] }\` for this terminal's
   chat log. Your stdin only carries the *latest* prompt — without this
   call, you have no memory of earlier turns and the chat feels amnesiac.
2. **Compose your reply** with that context in mind.
3. **Send the reply via \`grome__chat_response({ body })\`.** This appends an
   assistant record to \`.grome/.runtime/chat/{instanceId}.jsonl\`, which the
   IDE tails to render the chat panel.
4. **Keep stdout terse.** Tool calls, brief status lines, and command output
   are fine — but the substantive prose reply belongs in \`chat_response\`,
   not stdout. The terminal scrollback is a developer-details surface, not
   the primary UI.

## Other Grome surfaces (always available)

- **Threads** (\`.grome/threads/*.md\`) — cross-project messaging. Use
  \`grome__list_threads\` / \`grome__read_thread\` / \`grome__reply_thread\` /
  \`grome__new_thread\` / \`grome__resolve_thread\` for these. \`chat_response\`
  is **not** a substitute for thread replies — chat is the user channel,
  threads are the inter-project channel.
- **Sessions** (\`.grome/sessions/*.md\`) — handoff notes for the next agent
  in this same workspace. Use \`grome__list_sessions\` / \`grome__read_session\`.
- **Inbox** (\`grome__list_unread_inbox\` / \`grome__mark_inbox_read\`) — surfaces
  cross-project events.
- **Sync** (\`grome__sync\`) — propagates threads to peer workspaces. Run after
  appending a thread reply.

## Quick reference

| Situation | Tool |
|---|---|
| User typed in IDE chat panel (env-bound) | \`grome__read_chat_log\` → reason → \`grome__chat_response\` |
| Cross-project thread message arrived | \`grome__read_thread\` → \`grome__reply_thread\` → \`grome__sync\` |
| Need peer project paths / framework info | Read \`.grome/memory/project-manifest.json\` |
| Need full protocol details | Read \`.grome/grome.md\` |

For the full protocol — thread file format, session note format, watch
event semantics, auto-reply / auto-act authorization rules — see
\`.grome/grome.md\`. This skill is intentionally thin; that file is the
canonical reference.
`;
}
