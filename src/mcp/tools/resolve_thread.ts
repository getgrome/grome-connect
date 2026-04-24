import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWrite } from '../../utils.js';
import { ConnectionManager } from '../../core/ConnectionManager.js';
import { MemoryWriter } from '../../core/MemoryWriter.js';
import { resolveWriteTarget } from '../pathSafety.js';
import type { Tool } from '../types.js';

export const resolveThreadTool: Tool = {
  name: 'grome__resolve_thread',
  description:
    'Mark a thread as resolved: flips `**Status:** open` → `resolved` and appends a resolution footer. ' +
    'Idempotent-ish — if the thread is already resolved, returns { alreadyResolved: true } without re-writing. ' +
    'Runs sync to propagate.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Thread path (workspace-relative or bare filename).' },
      summary: { type: 'string', description: 'One-line resolution summary.' },
    },
    required: ['path', 'summary'],
  },
  handler: async (args, ctx) => {
    const { path: inputPath, summary } = args as { path: string; summary: string };
    if (!summary?.trim()) throw new Error('summary must be a non-empty string');

    const resolved = resolveWriteTarget(ctx.workspaceRoot, 'threads', inputPath);
    if (!fs.existsSync(resolved)) throw new Error(`Thread not found: ${inputPath}`);

    let content = fs.readFileSync(resolved, 'utf8');

    if (/\*\*Status:\*\*\s*resolved/i.test(content) && /\*\*Resolution:\*\*/i.test(content)) {
      return {
        path: path.relative(ctx.workspaceRoot, resolved),
        alreadyResolved: true,
        synced: false,
      };
    }

    content = content.replace(/(\*\*Status:\*\*\s*)open/i, '$1resolved');

    const projectName = ConnectionManager.getProjectName(ctx.workspaceRoot);
    const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const footer = `\n\n---\n\n**Resolution:** ${summary.trim()}\n**Resolved by:** ${projectName} @ ${ts}\n`;
    const appended = content.replace(/\s*$/, '') + footer;

    await atomicWrite(resolved, appended);

    try {
      await MemoryWriter.sync(ctx.workspaceRoot);
    } catch (err) {
      return {
        path: path.relative(ctx.workspaceRoot, resolved),
        alreadyResolved: false,
        wrote: true,
        synced: false,
        syncError: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      path: path.relative(ctx.workspaceRoot, resolved),
      alreadyResolved: false,
      wrote: true,
      synced: true,
      ts,
    };
  },
};
