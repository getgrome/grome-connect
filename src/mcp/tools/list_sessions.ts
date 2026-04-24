import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool } from '../types.js';

function parseSessionHeader(content: string): {
  title: string;
  date: string | null;
  status: string | null;
  kind: string | null;
} {
  let title = 'untitled';
  let kind: string | null = null;
  let body = content;

  const fm = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (fm) {
    body = fm[2];
    const kindMatch = fm[1].match(/^kind:\s*(.+)$/m);
    if (kindMatch) kind = kindMatch[1].trim();
  }

  const titleMatch = body.match(/^#\s*(?:Session:\s*)?(.+)$/m);
  if (titleMatch) title = titleMatch[1].trim();

  const dateMatch = body.match(/\*\*Date:\*\*\s*([^\n]+)/i);
  const statusMatch = body.match(/\*\*Status:\*\*\s*([^\n]+)/i);

  return {
    title,
    date: dateMatch ? dateMatch[1].trim() : null,
    status: statusMatch ? statusMatch[1].trim() : null,
    kind,
  };
}

export const listSessionsTool: Tool = {
  name: 'grome__list_sessions',
  description:
    'List session notes in .grome/sessions/. Returns title, date, status, and optional structured-data `kind` ' +
    'frontmatter for each. Includes the auto-generated history.md if present. Sorted newest-first by filename.',
  inputSchema: { type: 'object', properties: {} },
  handler: async (_args, ctx) => {
    const dir = path.join(ctx.workspaceRoot, '.grome', 'sessions');
    if (!fs.existsSync(dir)) return { sessions: [] };

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().reverse();
    const sessions = [];
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        const content = fs.readFileSync(full, 'utf8');
        const header = parseSessionHeader(content);
        sessions.push({
          path: path.relative(ctx.workspaceRoot, full),
          filename: file,
          ...header,
        });
      } catch {
        // skip unreadable
      }
    }
    return { sessions };
  },
};
