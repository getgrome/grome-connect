import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseThreadFile } from '../threadParser.js';
import type { Tool } from '../types.js';

interface Filter {
  status?: 'open' | 'resolved';
  to?: string;
  from?: string;
}

export const listThreadsTool: Tool = {
  name: 'grome__list_threads',
  description:
    'List threads in .grome/threads/. Optional filter by status (open|resolved), by `to` participant ' +
    '(matches if the thread is addressed to that project or to "all"), or by `from` project. ' +
    'Returns one summary entry per thread, sorted newest-first by filename.',
  inputSchema: {
    type: 'object',
    properties: {
      filter: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'resolved'] },
          to: { type: 'string' },
          from: { type: 'string' },
        },
      },
    },
  },
  handler: async (args, ctx) => {
    const filter = (args.filter as Filter | undefined) ?? {};
    const threadsDir = path.join(ctx.workspaceRoot, '.grome', 'threads');
    if (!fs.existsSync(threadsDir)) return { threads: [] };

    const files = fs
      .readdirSync(threadsDir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
      .sort()
      .reverse();

    const threads = [];
    for (const file of files) {
      const full = path.join(threadsDir, file);
      try {
        const parsed = parseThreadFile(full);
        if (filter.status && parsed.status !== filter.status) continue;
        if (filter.from && parsed.from !== filter.from) continue;
        if (filter.to) {
          const matches =
            parsed.to === 'all' ||
            (Array.isArray(parsed.to) &&
              (parsed.to.includes(filter.to) || parsed.to.includes('all')));
          if (!matches) continue;
        }

        const lastTurn = parsed.turns[parsed.turns.length - 1];
        threads.push({
          path: path.relative(ctx.workspaceRoot, full),
          subject: parsed.subject,
          from: parsed.from,
          to: parsed.to,
          status: parsed.status,
          startedAt: parsed.startedAt,
          lastSpeaker: lastTurn?.project ?? null,
          lastAuthor: lastTurn?.author ?? null,
          lastTs: lastTurn?.timestamp ?? null,
          turnCount: parsed.turns.length,
        });
      } catch {
        // Skip files that fail to parse; don't let one bad thread break the list.
      }
    }

    return { threads };
  },
};
