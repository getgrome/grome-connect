export type WatchEventKind = 'new-thread' | 'new-turn' | 'new-session';

export interface WatchEvent {
  kind: WatchEventKind;
  path: string;
  from: string | null;
  /** Optional per-agent router hint parsed from `## <project> @ <ts> [<agent>]`. */
  authorAgent?: string;
  ts: string;
  hash: string;
}
