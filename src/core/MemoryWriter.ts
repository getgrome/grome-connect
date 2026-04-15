import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Connection,
  ProjectManifest,
  Framework,
} from '../types.js';
import { ConnectionManager } from './ConnectionManager.js';
import { AgentConfigInjector } from './AgentConfigInjector.js';
import { detectFramework, detectLanguages } from '../extractors/detection.js';
import { atomicWrite, ensureDir } from '../utils.js';
import { CLI_VERSION, compareVersions } from '../version.js';

// Legacy memory files dropped in 0.3.0. `sync` unlinks these on sight so
// agents stop being pointed at ghosts. Kept here (not in the injected
// guidance) so the cleanup is purely mechanical.
const LEGACY_MEMORY_FILES = [
  'route-map.json',
  'shared-types.json',
  'api-schemas.json',
  'README.md',
];

/**
 * Read a project's config and return whether threads are enabled.
 * Missing config or missing field both default to `true` — threads are
 * opt-out, not opt-in.
 */
function threadsEnabled(projectRoot: string): boolean {
  try {
    const config = ConnectionManager.readConfig(projectRoot);
    return config.enableThreads !== false;
  } catch {
    return true;
  }
}

/**
 * Parse the header of a thread file for the index. Missing fields fall
 * back to defaults so an index can always be rendered.
 */
function parseThreadHeader(content: string): {
  subject: string;
  from: string;
  to: 'all' | string[];
  status: string;
  lastSpeaker: string | null;
  startedAt: string | null;
} {
  const field = (label: string): string | undefined => {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+)`, 'i');
    const m = content.match(re);
    return m ? m[1].trim() : undefined;
  };

  const titleMatch = content.match(/^#\s*(?:Thread:\s*)?(.+)$/m);
  const subject = titleMatch ? titleMatch[1].trim() : 'untitled';

  const from = field('From') ?? field('Started by') ?? 'unknown';
  const status = (field('Status') ?? 'open').toLowerCase();
  const startedAt = field('Started') ?? field('Date') ?? null;
  const toRaw = field('To') ?? 'all';
  const to: 'all' | string[] =
    toRaw.toLowerCase() === 'all'
      ? 'all'
      : toRaw.split(',').map((s) => s.trim()).filter(Boolean);

  const messageHeadings = [...content.matchAll(/^##\s+(.+?)\s*@\s*.+$/gm)];
  const lastSpeaker = messageHeadings.length > 0
    ? messageHeadings[messageHeadings.length - 1][1].trim()
    : null;

  return { subject, from, to, status, lastSpeaker, startedAt };
}

function countChecklist(content: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  const re = /^\s*[-*]\s+\[([ xX])\]\s+/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    total++;
    if (match[1].toLowerCase() === 'x') done++;
  }
  return { done, total };
}

export interface SyncResult {
  projects: Array<{ name: string; root: string; framework: Framework; languages: string[] }>;
  updatedConfigs: Map<string, string[]>;
  /** Files deleted by the one-shot legacy cleanup, per project. */
  legacyCleanup: Map<string, string[]>;
}

export class MemoryWriter {
  /**
   * Regenerate memory across all connected projects:
   * - write `project-manifest.json` (the only remaining memory file)
   * - write `.grome/grome.md` (protocol spec, via AgentConfigInjector)
   * - inject pointer blocks into each project's agent config files
   * - propagate threads and regenerate `_index.md` / `_index.json`
   * - unlink legacy snapshot files (`route-map.json`, `shared-types.json`,
   *   `api-schemas.json`, memory `README.md`) if they exist
   *
   * As of 0.3.0 there is no extraction phase. Snapshots were removed in
   * favor of threads + live grep against connected source trees.
   */
  static async sync(projectRoot: string): Promise<SyncResult> {
    const resolvedRoot = path.resolve(projectRoot);
    const allRoots = ConnectionManager.getAllProjectRoots(resolvedRoot);

    // Version-skew guard: if any connected project was last synced by a
    // newer CLI, bail. An older CLI silently drops fields it doesn't
    // recognize, which corrupts files the newer CLI had written.
    for (const root of allRoots) {
      const idx = readSyncIndex(root);
      if (idx.cliVersion && compareVersions(idx.cliVersion, CLI_VERSION) > 0) {
        const name = ConnectionManager.getProjectName(root);
        throw new Error(
          `Version skew: ${name} was last synced by grome-connect@${idx.cliVersion}, ` +
            `but this CLI is grome-connect@${CLI_VERSION}. Running an older CLI ` +
            `over newer files can drop data. Upgrade (\`npm i -g grome-connect@latest\`) ` +
            `and retry.`
        );
      }
    }

    const now = new Date().toISOString();
    const updatedConfigs = new Map<string, string[]>();
    const legacyCleanup = new Map<string, string[]>();
    const projects: SyncResult['projects'] = [];

    for (const root of allRoots) {
      const name = ConnectionManager.getProjectName(root);
      const framework = detectFramework(root);
      const languages = detectLanguages(root);
      projects.push({ name, root, framework, languages });

      // Manifest connections: each connected project's framework + languages.
      const connections = ConnectionManager.readConnections(root);
      const manifestConnections = connections.connections.map((conn) => ({
        ...conn,
        framework: detectFramework(conn.path),
        languages: detectLanguages(conn.path),
      }));

      const memoryDir = ConnectionManager.getMemoryDir(root);
      ensureDir(memoryDir);

      const manifest: ProjectManifest = {
        version: 2,
        generatedAt: now,
        cliVersion: CLI_VERSION,
        thisProject: name,
        connections: manifestConnections,
      };
      await atomicWrite(
        path.join(memoryDir, 'project-manifest.json'),
        JSON.stringify(manifest, null, 2)
      );

      // One-shot cleanup of legacy snapshot files. Best-effort; never fail sync.
      const removed: string[] = [];
      for (const f of LEGACY_MEMORY_FILES) {
        const p = path.join(memoryDir, f);
        try {
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            removed.push(f);
          }
        } catch { /* skip */ }
      }
      if (removed.length > 0) legacyCleanup.set(name, removed);

      // Agent-config injection (also refreshes `.grome/grome.md`).
      let agentTargets: string[] | undefined;
      try {
        const cfg = ConnectionManager.readConfig(root);
        if (Array.isArray(cfg.agentTargets) && cfg.agentTargets.length > 0) {
          agentTargets = cfg.agentTargets;
        }
      } catch { /* default */ }

      const { updated, created } = agentTargets
        ? AgentConfigInjector.inject(root, { targets: agentTargets, create: true })
        : AgentConfigInjector.inject(root);
      const touched = [...updated, ...created];
      if (touched.length > 0) updatedConfigs.set(name, touched);
    }

    // Threads propagate across all projects; regenerate per-project indexes.
    MemoryWriter.propagateThreads(allRoots);
    MemoryWriter.regenerateThreadIndexes(allRoots);

    // Stamp the sync index so future version-skew guards work.
    for (const root of allRoots) {
      writeSyncIndex(root, { cliVersion: CLI_VERSION });
    }

    return { projects, updatedConfigs, legacyCleanup };
  }

  /**
   * Propagate thread files (`.grome/threads/*.md`) across every
   * connected project. Mtime-wins: newest copy of a given filename
   * overwrites older copies in every other project.
   */
  private static propagateThreads(allRoots: string[]): void {
    type Entry = { absPath: string; mtimeMs: number };
    const byName = new Map<string, Entry>();

    // Reject mtimes strictly in the future (5 min skew tolerance) so a
    // `touch -d 2099` can't let a peer permanently own a thread.
    const SKEW_TOLERANCE_MS = 5 * 60 * 1000;
    const futureCutoff = Date.now() + SKEW_TOLERANCE_MS;
    for (const root of allRoots) {
      if (!threadsEnabled(root)) continue;
      const dir = path.join(ConnectionManager.getGromeDir(root), 'threads');
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.md') || name === '_index.md') continue;
        const absPath = path.join(dir, name);
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(absPath).mtimeMs; } catch { continue; }
        if (mtimeMs > futureCutoff) continue;
        const prev = byName.get(name);
        if (!prev || mtimeMs > prev.mtimeMs) byName.set(name, { absPath, mtimeMs });
      }
    }

    if (byName.size === 0) return;

    for (const root of allRoots) {
      if (!threadsEnabled(root)) continue;
      const dir = path.join(ConnectionManager.getGromeDir(root), 'threads');
      ensureDir(dir);
      for (const [name, entry] of byName) {
        const target = path.join(dir, name);
        if (target === entry.absPath) continue;
        try {
          const existing = fs.existsSync(target) ? fs.statSync(target).mtimeMs : -1;
          if (entry.mtimeMs > existing) fs.copyFileSync(entry.absPath, target);
        } catch { /* skip unreadable */ }
      }
    }
  }

  /**
   * Regenerate `_index.md` and `_index.json` in every project's threads
   * dir. Source of truth is always the individual `.md` files.
   */
  private static regenerateThreadIndexes(allRoots: string[]): void {
    for (const root of allRoots) {
      if (!threadsEnabled(root)) continue;
      const projectName = ConnectionManager.getProjectName(root);
      const dir = path.join(ConnectionManager.getGromeDir(root), 'threads');
      if (!fs.existsSync(dir)) continue;

      interface ThreadEntry {
        file: string;
        subject: string;
        from: string;
        to: string[];
        status: string;
        progress: { done: number; total: number } | null;
        lastSpeaker: string | null;
        lastActivity: string;
        startedAt: string | null;
        mtimeMs: number;
      }
      const entries: ThreadEntry[] = [];

      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.md') || name === '_index.md') continue;
        const absPath = path.join(dir, name);
        let content: string;
        let mtimeMs = 0;
        try {
          content = fs.readFileSync(absPath, 'utf-8');
          mtimeMs = fs.statSync(absPath).mtimeMs;
        } catch { continue; }

        const parsed = parseThreadHeader(content);
        const { done, total } = countChecklist(content);
        const to = parsed.to === 'all' ? ['all'] : parsed.to;

        entries.push({
          file: name,
          subject: parsed.subject,
          from: parsed.from,
          to,
          status: parsed.status,
          progress: total === 0 ? null : { done, total },
          lastSpeaker: parsed.lastSpeaker,
          lastActivity: new Date(mtimeMs).toISOString(),
          startedAt: parsed.startedAt,
          mtimeMs,
        });
      }

      entries.sort((a, b) => b.mtimeMs - a.mtimeMs);

      const rowLines = entries.map((e) => {
        const toLabel = e.to.join(', ');
        const progress = e.progress === null
          ? '—'
          : e.progress.done === e.progress.total
            ? '✓'
            : `${e.progress.done}/${e.progress.total}`;
        return `| [\`${e.file}\`](./${e.file}) | ${e.from} | ${toLabel} | ${e.status} | ${progress} | ${e.lastSpeaker ?? '—'} |`;
      });
      const mdBody = entries.length > 0
        ? [
          `# Threads for \`${projectName}\``,
          '',
          '> Auto-generated by `grome sync`. Source of truth is the individual `.md` files.',
          '> Append messages, flip checklist boxes, or change `**Status:**` in each file;',
          '> this index will reflect the change on the next sync.',
          '',
          '| Thread | From | To | Status | Progress | Last speaker |',
          '| ------ | ---- | -- | ------ | -------- | ------------ |',
          ...rowLines,
          '',
        ].join('\n')
        : [
          `# Threads for \`${projectName}\``,
          '',
          'No threads.',
          '',
        ].join('\n');

      try { fs.writeFileSync(path.join(dir, '_index.md'), mdBody); } catch { /* skip */ }

      const jsonBody = {
        version: 1 as const,
        cliVersion: CLI_VERSION,
        project: projectName,
        generatedAt: new Date().toISOString(),
        threads: entries.map(({ mtimeMs: _mtime, ...rest }) => rest),
      };
      try {
        fs.writeFileSync(
          path.join(dir, '_index.json'),
          JSON.stringify(jsonBody, null, 2)
        );
      } catch { /* skip */ }
    }
  }

  /**
   * Clear memory files from a project.
   */
  static async clearMemory(projectRoot: string): Promise<void> {
    const memoryDir = ConnectionManager.getMemoryDir(projectRoot);
    if (!fs.existsSync(memoryDir)) return;

    const files = ['project-manifest.json', ...LEGACY_MEMORY_FILES];
    for (const file of files) {
      const filePath = path.join(memoryDir, file);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch { /* skip */ }
      }
    }
  }
}

// ── Sync index ────────────────────────────────────────────────────

interface SyncIndex {
  cliVersion?: string;
}

function readSyncIndex(root: string): SyncIndex {
  try {
    const p = path.join(ConnectionManager.getGromeDir(root), '.sync-index.json');
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

function writeSyncIndex(root: string, data: SyncIndex): void {
  try {
    const p = path.join(ConnectionManager.getGromeDir(root), '.sync-index.json');
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, p);
  } catch { /* best-effort */ }
}
