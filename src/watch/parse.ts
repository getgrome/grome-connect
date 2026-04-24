import * as crypto from 'node:crypto';

/**
 * Parse the `**From:**` header from a thread file. Returns the raw value
 * (e.g. "grome", "grome-connect"). Null if absent.
 */
export function parseFrom(content: string): string | null {
  const m = content.match(/^\*\*From:\*\*\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

/**
 * Extract the last `## <project> @ <ts>` turn block (everything from the
 * last such header to EOF or the resolution footer). Used to hash turn
 * content so we can detect genuinely-new turns vs. cosmetic rewrites.
 *
 * Returns the block including the header line, or null if there's no
 * turn header in the file.
 */
export function extractLastTurn(content: string): string | null {
  const re = /^## .+? @ .+$/gm;
  let lastIdx = -1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    lastIdx = match.index;
  }
  if (lastIdx < 0) return null;
  // Strip trailing resolution footer so "flip to resolved" doesn't re-emit.
  const tail = content.slice(lastIdx);
  const footerIdx = tail.search(/\n---\s*\n\*\*Resolution:/);
  return footerIdx >= 0 ? tail.slice(0, footerIdx) : tail;
}

/**
 * Extract the speaker of the last turn (`## <project> @ <ts>` → `<project>`).
 */
export function parseLastSpeaker(content: string): string | null {
  const turn = extractLastTurn(content);
  if (!turn) return null;
  const m = turn.match(/^## (.+?) @ /);
  return m ? m[1].trim() : null;
}

/**
 * Extract the optional author-agent tag from the last turn header.
 * Convention: `## <project> @ <ISO ts> [<agent>]` — the `[agent]` suffix
 * is optional and used only for per-pane routing in IDE consumers.
 * Returns null when absent.
 */
export function parseLastAuthorAgent(content: string): string | null {
  const turn = extractLastTurn(content);
  if (!turn) return null;
  // Match the first line only so bracket-looking content in the body is ignored.
  const firstLine = turn.split('\n', 1)[0];
  const m = firstLine.match(/^## .+? @ \S+\s+\[([^\]]+)\]\s*$/);
  return m ? m[1].trim() : null;
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Hash the last turn of a thread (or the whole file if no turns exist yet —
 * opening messages live above the first turn header in some templates).
 */
export function hashThreadContent(content: string): string {
  const turn = extractLastTurn(content);
  return sha256(turn ?? content);
}

/**
 * For sessions, the whole file is the unit — we emit once on first-seen,
 * not on every edit. Hash the whole file for bookkeeping only.
 */
export function hashSessionContent(content: string): string {
  return sha256(content);
}
