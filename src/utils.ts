import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Atomic write: write to .tmp file then rename.
 * Ensures agents never read partial data.
 *
 * Both the write and the rename can fail (disk full, permissions,
 * cross-filesystem rename). On any failure the tmp file is cleaned up
 * and the error is re-thrown, so callers learn about it immediately
 * rather than discovering silent data loss on the next read.
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
    throw err;
  }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Format a relative time string.
 */
export function timeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  return 'just now';
}

// ── CLI output colors (ANSI escape codes) ──

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

export const color = {
  green: (s: string) => `${GREEN}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  cyan: (s: string) => `${CYAN}${s}${RESET}`,
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
};

export const symbols = {
  success: color.green('\u2713'),
  error: color.red('\u2717'),
  warning: color.yellow('\u26A0'),
  arrow: color.cyan('\u2194'),
};
