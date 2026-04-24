import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureDir } from '../../utils.js';
import { runtimeDir } from '../state.js';
import type { WatchEvent } from '../event.js';

export function inboxPath(projectRoot: string): string {
  return path.join(runtimeDir(projectRoot), 'inbox.jsonl');
}

export function appendEvent(projectRoot: string, event: WatchEvent): void {
  ensureDir(runtimeDir(projectRoot));
  fs.appendFileSync(inboxPath(projectRoot), JSON.stringify(event) + '\n', 'utf-8');
}
