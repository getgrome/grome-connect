import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureDir } from '../../utils.js';
import { CLI_VERSION } from '../../version.js';
import { getSession } from '../session.js';
import type { Tool } from '../types.js';

const CHAT_LOG_KIND = 'chat-log-v1';

function chatLogPath(workspaceRoot: string, terminalInstanceId: string): string {
  return path.join(
    workspaceRoot,
    '.grome',
    '.runtime',
    'chat',
    `${terminalInstanceId}.jsonl`,
  );
}

function ensureHeader(filePath: string, terminalInstanceId: string, agent: string | null): void {
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return;
  ensureDir(path.dirname(filePath));
  const header = {
    kind: CHAT_LOG_KIND,
    terminalId: terminalInstanceId,
    startedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    agent,
    cliVersion: CLI_VERSION,
  };
  fs.writeFileSync(filePath, JSON.stringify(header) + '\n', 'utf8');
}

export const chatResponseTool: Tool = {
  name: 'grome__chat_response',
  description:
    'Append an assistant response to the per-terminal chat log. Replaces "agent writes prose to stdout" ' +
    'as the canonical user-facing channel — the Grome IDE tails these logs to render its chat panel without ' +
    'parsing ANSI from the terminal buffer. Requires a prior `grome__register_session` call (or ' +
    'GROME_TERMINAL_INSTANCE_ID in the env). `markdown` defaults to true.',
  inputSchema: {
    type: 'object',
    properties: {
      body: { type: 'string', description: 'The response body.' },
      markdown: {
        type: 'boolean',
        description: 'If true (default), body is treated as markdown by the renderer.',
      },
    },
    required: ['body'],
  },
  handler: async (args, ctx) => {
    const { body, markdown } = args as { body: string; markdown?: boolean };
    if (!body?.trim()) throw new Error('body must be a non-empty string');

    const session = getSession();
    if (!session.terminalInstanceId) {
      throw new Error(
        'No terminal binding. Call grome__register_session({ terminalInstanceId }) first, ' +
        'or set GROME_TERMINAL_INSTANCE_ID in the env before spawning the server.',
      );
    }

    const logPath = chatLogPath(ctx.workspaceRoot, session.terminalInstanceId);
    ensureHeader(logPath, session.terminalInstanceId, session.agent);

    const record = {
      role: 'assistant',
      body,
      markdown: markdown ?? true,
      ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      agent: session.agent,
    };
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8');

    return {
      path: path.relative(ctx.workspaceRoot, logPath),
      wrote: true,
      ts: record.ts,
    };
  },
};
