import type { WatchEvent } from '../event.js';

/**
 * Stable one-line-per-event format read by both humans and agent harnesses.
 * Format is a contract — tools may parse it casually. Changes need a version bump.
 *
 * Shape: `[<kind>] <path> — from <project>`
 */
export function formatEvent(event: WatchEvent): string {
  const from = event.from ?? 'unknown';
  return `[${event.kind}] ${event.path} — from ${from}`;
}

export function emitEvent(event: WatchEvent): void {
  process.stdout.write(formatEvent(event) + '\n');
}
