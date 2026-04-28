import * as fs from 'node:fs';
import * as path from 'node:path';
import { getSession } from '../session.js';
import type { Tool } from '../types.js';

const CHAT_LOG_KIND = 'chat-log-v1';

interface ChatHeader {
  kind: typeof CHAT_LOG_KIND;
  terminalId: string;
  startedAt: string;
  agent: string | null;
  cliVersion: string;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  body: string;
  ts: string;
  agent?: string | null;
  markdown?: boolean;
}

function chatLogPath(workspaceRoot: string, terminalInstanceId: string): string {
  return path.join(workspaceRoot, '.grome', '.runtime', 'chat', `${terminalInstanceId}.jsonl`);
}

export const readChatLogTool: Tool = {
  name: 'grome__read_chat_log',
  description:
    'Read prior turns from this terminal\'s chat log. Symmetric with `grome__chat_response`. ' +
    'Call this before responding to any user prompt routed through the Grome IDE chat panel — ' +
    'agent stdin only carries the latest prompt, so without reading the log the assistant has no ' +
    'memory of earlier turns. Returns `{ header, turns }`. Empty/missing file → `{ header: null, turns: [] }`. ' +
    'Requires a prior `grome__register_session` call (or `GROME_TERMINAL_INSTANCE_ID` in env).',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_args, ctx) => {
    const session = getSession();
    if (!session.terminalInstanceId) {
      throw new Error(
        'No terminal binding. Call grome__register_session({ terminalInstanceId }) first, ' +
          'or set GROME_TERMINAL_INSTANCE_ID in the env before spawning the server.',
      );
    }

    const logPath = chatLogPath(ctx.workspaceRoot, session.terminalInstanceId);
    if (!fs.existsSync(logPath)) {
      return { path: path.relative(ctx.workspaceRoot, logPath), header: null, turns: [] };
    }

    const raw = fs.readFileSync(logPath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);

    let header: ChatHeader | null = null;
    const turns: ChatTurn[] = [];

    for (const [i, line] of lines.entries()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // skip malformed lines rather than fail the whole read
      }
      if (i === 0 && isHeader(parsed)) {
        header = parsed;
        continue;
      }
      if (isTurn(parsed)) {
        turns.push(parsed);
      }
    }

    return {
      path: path.relative(ctx.workspaceRoot, logPath),
      header,
      turns,
    };
  },
};

function isHeader(v: unknown): v is ChatHeader {
  return typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === CHAT_LOG_KIND;
}

function isTurn(v: unknown): v is ChatTurn {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as { role?: unknown; body?: unknown };
  return (o.role === 'user' || o.role === 'assistant') && typeof o.body === 'string';
}
