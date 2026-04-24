import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConnectionManager } from '../core/ConnectionManager.js';
import { color, symbols } from '../utils.js';
import type { WatchEvent } from '../watch/event.js';
import { checkPidFile, claimPidFile, releasePidFile } from '../watch/pidfile.js';
import { appendEvent, inboxPath } from '../watch/sinks/jsonl.js';
import { emitEvent } from '../watch/sinks/tail.js';
import { Watcher } from '../watch/watcher.js';

export interface WatchOptions {
  poll?: boolean;
  force?: boolean;
}

export async function watchCommand(opts: WatchOptions = {}): Promise<void> {
  const projectRoot = path.resolve(process.cwd());

  if (!ConnectionManager.isInitialized(projectRoot)) {
    console.error(
      `\n  ${symbols.error} ${color.red('Not initialized.')} Run ${color.cyan('grome init')} first.\n`
    );
    process.exit(1);
  }

  const existing = checkPidFile(projectRoot);
  if (!existing.canClaim && !opts.force) {
    // Another watcher is live. Tail the inbox jsonl so this invocation
    // still delivers events to whatever harness started it.
    tailInboxAndExit(projectRoot, existing.existingPid);
    return;
  }

  claimPidFile(projectRoot);

  const watcher = new Watcher({
    projectRoot,
    poll: opts.poll,
    onEvent: (event: WatchEvent) => {
      try {
        appendEvent(projectRoot, event);
      } catch (err) {
        console.error(
          `  ${symbols.warning} inbox write failed: ${(err as Error).message}`
        );
      }
      emitEvent(event);
    },
  });

  await watcher.seed();
  watcher.start();

  const projectName = ConnectionManager.getProjectName(projectRoot);
  console.error(
    `${symbols.success} watching .grome/threads/ + .grome/sessions/ in ${color.cyan(projectName)}${opts.poll ? color.dim(' (polling)') : ''}`
  );
  console.error(color.dim(`  inbox: ${path.relative(projectRoot, inboxPath(projectRoot))}`));
  console.error(color.dim(`  Ctrl+C to stop.\n`));

  const shutdown = () => {
    watcher.close();
    releasePidFile(projectRoot);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Another watcher is already running. Tail the existing inbox jsonl so
 * stdout still delivers events to the harness that started this call.
 * Uses a simple poll-based tail to avoid adding another fs.watch — this
 * is the fallback path, not the hot path.
 */
function tailInboxAndExit(projectRoot: string, existingPid: number | null): void {
  const inbox = inboxPath(projectRoot);
  const projectName = ConnectionManager.getProjectName(projectRoot);
  console.error(
    `${symbols.success} tailing existing watcher (pid ${color.cyan(String(existingPid ?? '?'))}) in ${color.cyan(projectName)}`
  );
  console.error(color.dim(`  inbox: ${path.relative(projectRoot, inbox)}`));
  console.error(color.dim(`  Ctrl+C to stop.\n`));

  // Start from end-of-file so we don't re-emit backlog.
  let offset = 0;
  try {
    offset = fs.existsSync(inbox) ? fs.statSync(inbox).size : 0;
  } catch {
    offset = 0;
  }

  const readNew = () => {
    try {
      if (!fs.existsSync(inbox)) return;
      const size = fs.statSync(inbox).size;
      if (size <= offset) return;
      const fd = fs.openSync(inbox, 'r');
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      offset = size;
      for (const line of buf.toString('utf-8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as WatchEvent;
          emitEvent(event);
        } catch {
          /* skip malformed lines */
        }
      }
    } catch {
      /* transient read errors are fine */
    }
  };

  const t = setInterval(readNew, 500);
  const shutdown = () => {
    clearInterval(t);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
