import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readChatLogTool } from '../src/mcp/tools/read_chat_log.js';
import { bindSession } from '../src/mcp/session.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grome-chat-test-'));
  bindSession('1', 'claude');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeLog(instanceId: string, lines: object[]): string {
  const dir = path.join(tmp, '.grome', '.runtime', 'chat');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${instanceId}.jsonl`);
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}

describe('grome__read_chat_log', () => {
  it('returns empty turns when file is missing', async () => {
    const result = (await readChatLogTool.handler({}, { workspaceRoot: tmp })) as {
      header: unknown;
      turns: unknown[];
    };
    expect(result.header).toBeNull();
    expect(result.turns).toEqual([]);
  });

  it('parses header + turns from a well-formed log', async () => {
    writeLog('1', [
      { kind: 'chat-log-v1', terminalId: '1', startedAt: '2026-04-28T00:00:00Z', agent: 'claude', cliVersion: '0.6.0' },
      { role: 'user', body: 'hi', ts: '2026-04-28T00:00:01Z' },
      { role: 'assistant', body: 'hello', ts: '2026-04-28T00:00:02Z', agent: 'claude' },
    ]);
    const result = (await readChatLogTool.handler({}, { workspaceRoot: tmp })) as {
      header: { kind: string };
      turns: Array<{ role: string; body: string }>;
    };
    expect(result.header?.kind).toBe('chat-log-v1');
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]).toMatchObject({ role: 'user', body: 'hi' });
    expect(result.turns[1]).toMatchObject({ role: 'assistant', body: 'hello' });
  });

  it('skips malformed lines without failing the whole read', async () => {
    const dir = path.join(tmp, '.grome', '.runtime', 'chat');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '1.jsonl'),
      [
        JSON.stringify({ kind: 'chat-log-v1', terminalId: '1', startedAt: 'x', agent: null, cliVersion: '0' }),
        '{not valid json',
        JSON.stringify({ role: 'user', body: 'survives', ts: 't' }),
      ].join('\n'),
    );
    const result = (await readChatLogTool.handler({}, { workspaceRoot: tmp })) as {
      turns: Array<{ body: string }>;
    };
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].body).toBe('survives');
  });

  it('throws when no terminal is bound', async () => {
    bindSession('', undefined as unknown as string); // wipe binding by directly clearing state
    // bindSession requires non-empty; mimic unset by mutating state via re-import not feasible.
    // Instead, exercise the chat_response-style throw by calling without setting env first.
    // We achieve this by importing session again and clearing terminalInstanceId.
    const sessionMod = await import('../src/mcp/session.js');
    sessionMod.getSession().terminalInstanceId = null;

    await expect(readChatLogTool.handler({}, { workspaceRoot: tmp })).rejects.toThrow(
      /No terminal binding/,
    );
  });
});
