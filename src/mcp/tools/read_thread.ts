import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseThreadFile } from '../threadParser.js';
import type { Tool } from '../types.js';

export const readThreadTool: Tool = {
  name: 'grome__read_thread',
  description:
    'Read a thread from .grome/threads/ and return its structured turns, status, and participants. ' +
    'Accepts either a path relative to the workspace root (e.g. ".grome/threads/2026-04-23-2251-mcp-1-6-planning.md") ' +
    'or just the filename (the server resolves it against the workspace threads dir).',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Path to the thread file. May be workspace-relative or a bare filename in .grome/threads/.',
      },
    },
    required: ['path'],
  },
  handler: async ({ path: inputPath }, ctx) => {
    if (typeof inputPath !== 'string' || !inputPath.trim()) {
      throw new Error('path must be a non-empty string');
    }

    const candidates: string[] = [];
    if (path.isAbsolute(inputPath)) {
      candidates.push(inputPath);
    } else {
      candidates.push(path.join(ctx.workspaceRoot, inputPath));
      if (!inputPath.includes('/')) {
        candidates.push(path.join(ctx.workspaceRoot, '.grome', 'threads', inputPath));
      }
    }

    const resolved = candidates.find((p) => fs.existsSync(p));
    if (!resolved) {
      throw new Error(`Thread not found. Tried: ${candidates.join(', ')}`);
    }

    // Guard against path traversal out of the workspace.
    const real = fs.realpathSync(resolved);
    const rootReal = fs.realpathSync(ctx.workspaceRoot);
    if (!real.startsWith(rootReal + path.sep) && real !== rootReal) {
      throw new Error('Thread path escapes workspace root');
    }

    return parseThreadFile(real);
  },
};
