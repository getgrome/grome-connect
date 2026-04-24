import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWrite, ensureDir } from '../../utils.js';
import { ConnectionManager } from '../../core/ConnectionManager.js';
import { MemoryWriter } from '../../core/MemoryWriter.js';
import { resolveWriteTarget, slugify, threadTimestamp } from '../pathSafety.js';
import type { Tool } from '../types.js';

export const newThreadTool: Tool = {
  name: 'grome__new_thread',
  description:
    'Create a new thread file in .grome/threads/ and run sync. Filename is ' +
    '`<YYYY-MM-DD-HHmm>-<slugified-subject>.md`. Use `to` = "all", a single project name, or an array of names. ' +
    'Include `checklist` only when there are concrete action items.',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Thread subject line.' },
      to: {
        description: 'Recipient(s). "all", a single project name, or an array of names.',
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
      body: { type: 'string', description: 'Opening-turn body (markdown).' },
      author: { type: 'string', description: 'Optional agent tag (e.g. "claude").' },
      checklist: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional action-item checklist. Omit for questions / FYIs.',
      },
    },
    required: ['subject', 'to', 'body'],
  },
  handler: async (args, ctx) => {
    const { subject, to, body, author, checklist } = args as {
      subject: string;
      to: string | string[];
      body: string;
      author?: string;
      checklist?: string[];
    };

    if (!subject?.trim()) throw new Error('subject must be a non-empty string');
    if (!body?.trim()) throw new Error('body must be a non-empty string');
    const toField = Array.isArray(to) ? to.join(', ') : to;
    if (!toField?.trim()) throw new Error('to must be a non-empty string or array');

    const slug = slugify(subject);
    const ts = threadTimestamp();
    const filename = `${ts}-${slug}.md`;

    const targetPath = resolveWriteTarget(ctx.workspaceRoot, 'threads', filename);
    if (fs.existsSync(targetPath)) {
      throw new Error(`Thread already exists: ${filename}`);
    }

    const projectName = ConnectionManager.getProjectName(ctx.workspaceRoot);
    const isoTs = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const authorTag = author ? ` [${author}]` : '';

    let content = `# Thread: ${subject.trim()}\n\n`;
    content += `**From:** ${projectName}\n`;
    content += `**To:** ${toField}\n`;
    content += `**Started:** ${isoTs}\n`;
    content += `**Status:** open\n\n`;
    content += `---\n\n`;
    content += `## ${projectName} @ ${isoTs}${authorTag}\n\n`;
    content += `${body.trim()}\n`;

    if (checklist && checklist.length > 0) {
      content += `\n`;
      for (const item of checklist) content += `- [ ] ${item}\n`;
    }

    ensureDir(path.dirname(targetPath));
    await atomicWrite(targetPath, content);

    try {
      await MemoryWriter.sync(ctx.workspaceRoot);
    } catch (err) {
      return {
        path: path.relative(ctx.workspaceRoot, targetPath),
        wrote: true,
        synced: false,
        syncError: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      path: path.relative(ctx.workspaceRoot, targetPath),
      wrote: true,
      synced: true,
      ts: isoTs,
    };
  },
};
