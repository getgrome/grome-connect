import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool } from '../types.js';

export const readSessionTool: Tool = {
  name: 'grome__read_session',
  description:
    'Read a session note from .grome/sessions/ and return its content plus any structured-data `kind` ' +
    'frontmatter. Accepts either a workspace-relative path or a bare filename.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Path to the session file. May be workspace-relative or a bare filename in .grome/sessions/.',
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
        candidates.push(path.join(ctx.workspaceRoot, '.grome', 'sessions', inputPath));
      }
    }

    const resolved = candidates.find((p) => fs.existsSync(p));
    if (!resolved) {
      throw new Error(`Session not found. Tried: ${candidates.join(', ')}`);
    }

    const real = fs.realpathSync(resolved);
    const rootReal = fs.realpathSync(ctx.workspaceRoot);
    if (!real.startsWith(rootReal + path.sep) && real !== rootReal) {
      throw new Error('Session path escapes workspace root');
    }

    const content = fs.readFileSync(real, 'utf8');
    const fm = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    let kind: string | undefined;
    if (fm) {
      const kindMatch = fm[1].match(/^kind:\s*(.+)$/m);
      if (kindMatch) kind = kindMatch[1].trim();
    }

    return {
      path: path.relative(ctx.workspaceRoot, real),
      content,
      kind,
    };
  },
};
