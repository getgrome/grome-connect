import * as fs from 'node:fs';
import { atomicWrite, ensureDir } from '../../utils.js';
import * as path from 'node:path';
import { inboxReadCursorPath, loadReadHashes } from './list_unread_inbox.js';
import type { Tool } from '../types.js';

export const markInboxReadTool: Tool = {
  name: 'grome__mark_inbox_read',
  description:
    'Mark inbox events as read by persisting their hashes to .grome/.runtime/inbox.read.json. ' +
    'Omit `hashes` to mark every event currently in the inbox as read.',
  inputSchema: {
    type: 'object',
    properties: {
      hashes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Event hashes to mark read. Omit to mark all unread events.',
      },
    },
  },
  handler: async (args, ctx) => {
    const { hashes } = args as { hashes?: string[] };
    const existing = loadReadHashes(ctx.workspaceRoot);

    let toAdd: string[];
    if (hashes && hashes.length > 0) {
      toAdd = hashes;
    } else {
      const inboxPath = path.join(ctx.workspaceRoot, '.grome', '.runtime', 'inbox.jsonl');
      if (!fs.existsSync(inboxPath)) return { marked: 0, total: existing.size };
      toAdd = [];
      for (const line of fs.readFileSync(inboxPath, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const evt = JSON.parse(t) as { hash?: string };
          if (evt.hash) toAdd.push(evt.hash);
        } catch {
          // skip malformed
        }
      }
    }

    let added = 0;
    for (const h of toAdd) {
      if (!existing.has(h)) {
        existing.add(h);
        added++;
      }
    }

    const cursorPath = inboxReadCursorPath(ctx.workspaceRoot);
    ensureDir(path.dirname(cursorPath));
    await atomicWrite(cursorPath, JSON.stringify({ hashes: [...existing] }, null, 2) + '\n');

    return { marked: added, total: existing.size };
  },
};
