import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool } from '../types.js';

interface InboxEvent {
  kind: string;
  path: string;
  from: string | null;
  authorAgent?: string;
  ts: string;
  hash: string;
}

export function inboxReadCursorPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.grome', '.runtime', 'inbox.read.json');
}

export function loadReadHashes(workspaceRoot: string): Set<string> {
  const p = inboxReadCursorPath(workspaceRoot);
  if (!fs.existsSync(p)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { hashes?: string[] };
    return new Set(raw.hashes ?? []);
  } catch {
    return new Set();
  }
}

export const listUnreadInboxTool: Tool = {
  name: 'grome__list_unread_inbox',
  description:
    'List unread watcher events from .grome/.runtime/inbox.jsonl. Events are marked read via ' +
    '`grome__mark_inbox_read`, which persists read-hashes to .grome/.runtime/inbox.read.json. ' +
    'Returns [] if the watcher hasn\'t run yet. Each event includes its `hash` so callers can mark it read.',
  inputSchema: { type: 'object', properties: {} },
  handler: async (_args, ctx) => {
    const inboxPath = path.join(ctx.workspaceRoot, '.grome', '.runtime', 'inbox.jsonl');
    if (!fs.existsSync(inboxPath)) return { events: [] };

    const readHashes = loadReadHashes(ctx.workspaceRoot);
    const lines = fs.readFileSync(inboxPath, 'utf8').split('\n');
    const events: InboxEvent[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed) as InboxEvent;
        if (!readHashes.has(evt.hash)) events.push(evt);
      } catch {
        // skip malformed lines
      }
    }

    return { events };
  },
};
