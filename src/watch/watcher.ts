import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConnectionManager } from '../core/ConnectionManager.js';
import type { WatchEvent } from './event.js';
import {
  hashSessionContent,
  hashThreadContent,
  parseFrom,
  parseLastAuthorAgent,
  parseLastSpeaker,
} from './parse.js';
import { loadState, saveState, type WatchState } from './state.js';

const DEBOUNCE_MS = 150;

/** Only .md files in the target dirs are considered. Ignore `_index.md` and hidden files. */
function isTrackedThreadFile(filename: string): boolean {
  if (!filename.endsWith('.md')) return false;
  if (filename === '_index.md') return false;
  if (filename.startsWith('.') || filename.startsWith('_')) return false;
  return true;
}

function isTrackedSessionFile(filename: string): boolean {
  if (!filename.endsWith('.md')) return false;
  if (filename.startsWith('.')) return false;
  // `history.md` is IDE-generated and churns; skip it.
  if (filename === 'history.md') return false;
  return true;
}

export interface WatcherOptions {
  projectRoot: string;
  onEvent: (event: WatchEvent) => void;
  /** If true, run in polling mode (setInterval readdir) instead of fs.watch. */
  poll?: boolean;
  /** Polling interval in ms (only used when poll=true). Default 1000. */
  pollIntervalMs?: number;
}

export class Watcher {
  private readonly projectRoot: string;
  private readonly threadsDir: string;
  private readonly sessionsDir: string;
  private readonly onEvent: (e: WatchEvent) => void;
  private readonly poll: boolean;
  private readonly pollIntervalMs: number;

  private state: WatchState;
  private readonly debounces = new Map<string, ReturnType<typeof setTimeout>>();
  private threadWatcher: fs.FSWatcher | null = null;
  private sessionWatcher: fs.FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(opts: WatcherOptions) {
    this.projectRoot = opts.projectRoot;
    this.threadsDir = path.join(opts.projectRoot, '.grome', 'threads');
    this.sessionsDir = path.join(opts.projectRoot, '.grome', 'sessions');
    this.onEvent = opts.onEvent;
    this.poll = opts.poll ?? false;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
    this.state = loadState(opts.projectRoot);
  }

  /**
   * Seed state from existing files without emitting. Call on startup so
   * pre-existing threads/sessions don't all emit on first boot.
   */
  async seed(): Promise<void> {
    this.seedDir(this.threadsDir, 'thread');
    this.seedDir(this.sessionsDir, 'session');
    await saveState(this.projectRoot, this.state);
  }

  private seedDir(dir: string, kind: 'thread' | 'session'): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const check = kind === 'thread' ? isTrackedThreadFile : isTrackedSessionFile;
      if (!check(entry)) continue;
      const full = path.join(dir, entry);
      let content: string;
      try {
        content = fs.readFileSync(full, 'utf-8');
      } catch {
        continue;
      }
      const relPath = path.relative(this.projectRoot, full);
      if (kind === 'thread') {
        this.state.threads[relPath] = {
          lastTurnHash: hashThreadContent(content),
          lastEmittedAt: new Date().toISOString(),
        };
      } else {
        this.state.sessions[relPath] = {
          firstSeenAt: new Date().toISOString(),
        };
      }
    }
  }

  start(): void {
    if (this.poll) {
      this.startPolling();
    } else {
      this.startNative();
    }
  }

  private startNative(): void {
    if (fs.existsSync(this.threadsDir)) {
      this.threadWatcher = fs.watch(this.threadsDir, (_event, filename) => {
        if (!filename) return;
        if (!isTrackedThreadFile(filename)) return;
        this.schedule(path.join(this.threadsDir, filename), 'thread');
      });
    }
    if (fs.existsSync(this.sessionsDir)) {
      this.sessionWatcher = fs.watch(this.sessionsDir, (_event, filename) => {
        if (!filename) return;
        if (!isTrackedSessionFile(filename)) return;
        this.schedule(path.join(this.sessionsDir, filename), 'session');
      });
    }
  }

  private startPolling(): void {
    const mtimes = new Map<string, number>();
    const scanDir = (dir: string, kind: 'thread' | 'session') => {
      if (!fs.existsSync(dir)) return;
      const check = kind === 'thread' ? isTrackedThreadFile : isTrackedSessionFile;
      for (const entry of fs.readdirSync(dir)) {
        if (!check(entry)) continue;
        const full = path.join(dir, entry);
        try {
          const mt = fs.statSync(full).mtimeMs;
          const prev = mtimes.get(full);
          if (prev !== mt) {
            mtimes.set(full, mt);
            if (prev !== undefined) this.schedule(full, kind);
          }
        } catch {
          /* skip */
        }
      }
    };
    // Seed mtimes without firing.
    scanDir(this.threadsDir, 'thread');
    scanDir(this.sessionsDir, 'session');
    this.pollTimer = setInterval(() => {
      scanDir(this.threadsDir, 'thread');
      scanDir(this.sessionsDir, 'session');
    }, this.pollIntervalMs);
  }

  private schedule(fullPath: string, kind: 'thread' | 'session'): void {
    const existing = this.debounces.get(fullPath);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      this.debounces.delete(fullPath);
      if (this.closed) return;
      void this.process(fullPath, kind);
    }, DEBOUNCE_MS);
    this.debounces.set(fullPath, t);
  }

  private async process(fullPath: string, kind: 'thread' | 'session'): Promise<void> {
    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      // File may have been deleted between event and read.
      return;
    }
    const relPath = path.relative(this.projectRoot, fullPath);

    if (kind === 'thread') {
      const hash = hashThreadContent(content);
      const prev = this.state.threads[relPath];
      if (prev && prev.lastTurnHash === hash) return;
      const from = parseLastSpeaker(content) ?? parseFrom(content);
      const authorAgent = parseLastAuthorAgent(content);
      const event: WatchEvent = {
        kind: prev ? 'new-turn' : 'new-thread',
        path: relPath,
        from,
        ts: new Date().toISOString(),
        hash,
        ...(authorAgent ? { authorAgent } : {}),
      };
      this.state.threads[relPath] = {
        lastTurnHash: hash,
        lastEmittedAt: event.ts,
      };
      await saveState(this.projectRoot, this.state);
      this.onEvent(event);
    } else {
      if (this.state.sessions[relPath]) return;
      const hash = hashSessionContent(content);
      const project = ConnectionManager.isInitialized(this.projectRoot)
        ? ConnectionManager.getProjectName(this.projectRoot)
        : null;
      const event: WatchEvent = {
        kind: 'new-session',
        path: relPath,
        from: project,
        ts: new Date().toISOString(),
        hash,
      };
      this.state.sessions[relPath] = { firstSeenAt: event.ts };
      await saveState(this.projectRoot, this.state);
      this.onEvent(event);
    }
  }

  close(): void {
    this.closed = true;
    for (const t of this.debounces.values()) clearTimeout(t);
    this.debounces.clear();
    this.threadWatcher?.close();
    this.sessionWatcher?.close();
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}
