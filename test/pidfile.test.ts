import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkPidFile, claimPidFile, pidFilePath, releasePidFile } from '../src/watch/pidfile.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grome-watch-pid-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('pidfile', () => {
  it('canClaim when no pidfile exists', () => {
    expect(checkPidFile(tmp).canClaim).toBe(true);
  });

  it('claim + release round-trip', () => {
    claimPidFile(tmp);
    expect(fs.existsSync(pidFilePath(tmp))).toBe(true);
    expect(fs.readFileSync(pidFilePath(tmp), 'utf-8').trim()).toBe(String(process.pid));
    releasePidFile(tmp);
    expect(fs.existsSync(pidFilePath(tmp))).toBe(false);
  });

  it('canClaim when existing pid is dead', () => {
    fs.mkdirSync(path.join(tmp, '.grome', '.runtime'), { recursive: true });
    // pid 1 is init/launchd; we use an unlikely-to-exist large pid.
    fs.writeFileSync(pidFilePath(tmp), '9999999');
    expect(checkPidFile(tmp).canClaim).toBe(true);
  });

  it('canClaim when pidfile contains current process pid (self — stale claim)', () => {
    claimPidFile(tmp);
    // Our own pid is "alive" but pidfile.ts treats self-claim as claimable
    // so we don't deadlock on restart in the same process (unit-test shape).
    const result = checkPidFile(tmp);
    expect(result.canClaim).toBe(true);
  });

  it('canClaim=false when another live pid holds it', () => {
    // Use the parent's pid — it's guaranteed alive but not ours.
    const other = process.ppid || 1;
    if (other === process.pid) return; // skip if weird env
    fs.mkdirSync(path.join(tmp, '.grome', '.runtime'), { recursive: true });
    fs.writeFileSync(pidFilePath(tmp), String(other));
    const result = checkPidFile(tmp);
    expect(result.canClaim).toBe(false);
    expect(result.existingPid).toBe(other);
  });

  it('canClaim on garbage pidfile contents', () => {
    fs.mkdirSync(path.join(tmp, '.grome', '.runtime'), { recursive: true });
    fs.writeFileSync(pidFilePath(tmp), 'not-a-number');
    expect(checkPidFile(tmp).canClaim).toBe(true);
  });
});
