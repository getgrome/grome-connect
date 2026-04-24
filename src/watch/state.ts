import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWrite, ensureDir } from '../utils.js';

export interface ThreadState {
  lastTurnHash: string;
  lastEmittedAt: string;
}

export interface SessionState {
  firstSeenAt: string;
}

export interface WatchState {
  threads: Record<string, ThreadState>;
  sessions: Record<string, SessionState>;
}

const EMPTY_STATE: WatchState = { threads: {}, sessions: {} };

export function runtimeDir(projectRoot: string): string {
  return path.join(projectRoot, '.grome', '.runtime');
}

export function stateFilePath(projectRoot: string): string {
  return path.join(runtimeDir(projectRoot), 'watch-state.json');
}

export function loadState(projectRoot: string): WatchState {
  const p = stateFilePath(projectRoot);
  if (!fs.existsSync(p)) return structuredClone(EMPTY_STATE);
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WatchState>;
    return {
      threads: parsed.threads ?? {},
      sessions: parsed.sessions ?? {},
    };
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

export async function saveState(projectRoot: string, state: WatchState): Promise<void> {
  ensureDir(runtimeDir(projectRoot));
  await atomicWrite(stateFilePath(projectRoot), JSON.stringify(state, null, 2));
}
