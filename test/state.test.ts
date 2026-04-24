import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadState, saveState, stateFilePath } from '../src/watch/state.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grome-watch-state-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('watch state', () => {
  it('returns empty state when file is missing', () => {
    const s = loadState(tmp);
    expect(s).toEqual({ threads: {}, sessions: {} });
  });

  it('round-trips writes', async () => {
    await saveState(tmp, {
      threads: { '.grome/threads/a.md': { lastTurnHash: 'abc', lastEmittedAt: '2026-01-01T00:00:00Z' } },
      sessions: { '.grome/sessions/b.md': { firstSeenAt: '2026-01-01T00:00:00Z' } },
    });
    expect(fs.existsSync(stateFilePath(tmp))).toBe(true);
    const s = loadState(tmp);
    expect(s.threads['.grome/threads/a.md'].lastTurnHash).toBe('abc');
    expect(s.sessions['.grome/sessions/b.md'].firstSeenAt).toBe('2026-01-01T00:00:00Z');
  });

  it('recovers from corrupt JSON with empty state', () => {
    fs.mkdirSync(path.join(tmp, '.grome', '.runtime'), { recursive: true });
    fs.writeFileSync(stateFilePath(tmp), '{not json');
    const s = loadState(tmp);
    expect(s).toEqual({ threads: {}, sessions: {} });
  });
});
