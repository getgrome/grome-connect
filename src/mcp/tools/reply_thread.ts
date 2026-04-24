import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWrite } from '../../utils.js';
import { ConnectionManager } from '../../core/ConnectionManager.js';
import { MemoryWriter } from '../../core/MemoryWriter.js';
import { resolveWriteTarget } from '../pathSafety.js';
import type { Tool } from '../types.js';

export const replyThreadTool: Tool = {
  name: 'grome__reply_thread',
  description:
    'Append a new turn to an existing thread in .grome/threads/. Handler writes the turn block ' +
    '(## <this-project> @ <ISO ts> [<author>]), flips any checklist items in `completedChecklist` ' +
    '(exact-match string compare), optionally resolves the thread, and runs sync to propagate. ' +
    'Atomic — no partial state.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Thread path (workspace-relative or bare filename).' },
      body: { type: 'string', description: 'The reply body (markdown).' },
      author: {
        type: 'string',
        description: 'Optional agent tag appended as `[<author>]` on the turn header (e.g. "claude").',
      },
      completedChecklist: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of checklist-item text to flip from `[ ]` to `[x]`. Exact string match required.',
      },
      resolve: { type: 'boolean', description: 'If true, also resolve the thread (see grome__resolve_thread).' },
      resolution: { type: 'string', description: 'One-line resolution summary (required if resolve=true).' },
    },
    required: ['path', 'body'],
  },
  handler: async (args, ctx) => {
    const { path: inputPath, body, author, completedChecklist, resolve, resolution } = args as {
      path: string;
      body: string;
      author?: string;
      completedChecklist?: string[];
      resolve?: boolean;
      resolution?: string;
    };

    if (typeof body !== 'string' || !body.trim()) throw new Error('body must be a non-empty string');
    if (resolve && (!resolution || !resolution.trim())) {
      throw new Error('resolution summary is required when resolve=true');
    }

    const resolved = resolveWriteTarget(ctx.workspaceRoot, 'threads', inputPath);
    if (!fs.existsSync(resolved)) throw new Error(`Thread not found: ${inputPath}`);

    let content = fs.readFileSync(resolved, 'utf8');

    // Flip checklist items.
    if (completedChecklist && completedChecklist.length > 0) {
      for (const item of completedChecklist) {
        const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`^(\\s*[-*]\\s+)\\[ \\](\\s+${escaped}\\s*)$`, 'm');
        content = content.replace(re, '$1[x]$2');
      }
    }

    // Flip status if resolving.
    if (resolve) {
      content = content.replace(/(\*\*Status:\*\*\s*)open/i, '$1resolved');
    }

    const projectName = ConnectionManager.getProjectName(ctx.workspaceRoot);
    const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const authorTag = author ? ` [${author}]` : '';
    const turnBlock = `\n## ${projectName} @ ${ts}${authorTag}\n\n${body.trim()}\n`;

    let appended = content.replace(/\s*$/, '') + '\n' + turnBlock;

    if (resolve) {
      appended = appended.replace(/\s*$/, '') +
        `\n\n---\n\n**Resolution:** ${resolution!.trim()}\n**Resolved by:** ${projectName} @ ${ts}\n`;
    }

    await atomicWrite(resolved, appended);

    // Propagate. sync() regenerates _index.md and copies to peers.
    try {
      await MemoryWriter.sync(ctx.workspaceRoot);
    } catch (err) {
      // Turn was written; sync failure is surfaced but not fatal to the reply.
      return {
        path: path.relative(ctx.workspaceRoot, resolved),
        wrote: true,
        synced: false,
        syncError: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      path: path.relative(ctx.workspaceRoot, resolved),
      wrote: true,
      synced: true,
      ts,
    };
  },
};
