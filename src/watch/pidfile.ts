import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureDir } from '../utils.js';
import { runtimeDir } from './state.js';

export function pidFilePath(projectRoot: string): string {
  return path.join(runtimeDir(projectRoot), 'watch.pid');
}

/**
 * Check whether a pid is alive. `process.kill(pid, 0)` sends no signal —
 * it only throws if the pid doesn't belong to a live process we can signal.
 * Cross-platform on Node 18+.
 */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = process exists but we can't signal it
    // (still alive — treat as live to avoid double-watching).
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

export interface PidCheck {
  /** True if no live watcher exists; caller should claim. */
  canClaim: boolean;
  /** The live pid we found, if any. */
  existingPid: number | null;
}

export function checkPidFile(projectRoot: string): PidCheck {
  const p = pidFilePath(projectRoot);
  if (!fs.existsSync(p)) return { canClaim: true, existingPid: null };
  try {
    const raw = fs.readFileSync(p, 'utf-8').trim();
    const pid = Number.parseInt(raw, 10);
    if (Number.isNaN(pid)) return { canClaim: true, existingPid: null };
    if (isAlive(pid) && pid !== process.pid) {
      return { canClaim: false, existingPid: pid };
    }
    return { canClaim: true, existingPid: null };
  } catch {
    return { canClaim: true, existingPid: null };
  }
}

export function claimPidFile(projectRoot: string): void {
  ensureDir(runtimeDir(projectRoot));
  fs.writeFileSync(pidFilePath(projectRoot), String(process.pid), 'utf-8');
}

export function releasePidFile(projectRoot: string): void {
  const p = pidFilePath(projectRoot);
  try {
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf-8').trim();
    if (Number.parseInt(raw, 10) === process.pid) {
      fs.unlinkSync(p);
    }
  } catch {
    /* best effort */
  }
}
