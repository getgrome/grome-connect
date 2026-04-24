import * as fs from 'node:fs';

export interface ThreadTurn {
  project: string;
  author?: string;
  timestamp: string;
  body: string;
}

export interface ParsedThread {
  subject: string;
  from: string;
  to: 'all' | string[];
  status: string;
  startedAt: string | null;
  turns: ThreadTurn[];
  resolution?: { summary: string; by: string; at: string };
}

function field(content: string, label: string): string | undefined {
  const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+)`, 'i');
  const m = content.match(re);
  return m ? m[1].trim() : undefined;
}

const TURN_HEADER = /^##\s+([^\s@]+)\s*@\s*([^\s[\]]+)\s*(?:\[([^\]]+)\])?\s*$/gm;

export function parseThreadFile(filePath: string): ParsedThread {
  const content = fs.readFileSync(filePath, 'utf8');

  const titleMatch = content.match(/^#\s*(?:Thread:\s*)?(.+)$/m);
  const subject = titleMatch ? titleMatch[1].trim() : 'untitled';
  const from = field(content, 'From') ?? 'unknown';
  const status = (field(content, 'Status') ?? 'open').toLowerCase();
  const startedAt = field(content, 'Started') ?? null;
  const toRaw = field(content, 'To') ?? 'all';
  const to: 'all' | string[] =
    toRaw.toLowerCase() === 'all'
      ? 'all'
      : toRaw.split(',').map((s) => s.trim()).filter(Boolean);

  const turns: ThreadTurn[] = [];
  const matches = [...content.matchAll(TURN_HEADER)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? content.length : content.length;
    let body = content.slice(start, end).trim();
    // Strip trailing resolution footer if present in the last turn body.
    body = body.replace(/\n+---\s*\n+\*\*Resolution:\*\*[\s\S]*$/i, '').trim();
    turns.push({
      project: m[1].trim(),
      timestamp: m[2].trim(),
      author: m[3]?.trim(),
      body,
    });
  }

  let resolution: ParsedThread['resolution'];
  const resMatch = content.match(
    /\*\*Resolution:\*\*\s*([^\n]+)\s*\n\s*\*\*Resolved by:\*\*\s*([^\s@]+)\s*@\s*([^\s\n]+)/i
  );
  if (resMatch) {
    resolution = { summary: resMatch[1].trim(), by: resMatch[2].trim(), at: resMatch[3].trim() };
  }

  return { subject, from, to, status, startedAt, turns, resolution };
}
