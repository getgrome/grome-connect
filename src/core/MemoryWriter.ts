import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  GromeConfig,
  ExtractionResult,
  ExtractedRoute,
  ExtractedType,
  ExtractedSchema,
  Connection,
  RouteMapFile,
  SharedTypesFile,
  ApiSchemasFile,
  ProjectManifest,
  Framework,
} from '../types.js';
import { ConnectionManager } from './ConnectionManager.js';
import { Scanner } from './Scanner.js';
import { PermissionChecker } from './PermissionChecker.js';
import { AgentConfigInjector } from './AgentConfigInjector.js';
import { extractRoutes } from '../extractors/routes.js';
import { extractTypes } from '../extractors/types.js';
import { extractSchemas } from '../extractors/schemas.js';
import { detectFramework } from '../extractors/detection.js';
import { atomicWrite, ensureDir } from '../utils.js';
import micromatch from 'micromatch';

interface ProjectScanResult {
  name: string;
  root: string;
  framework: Framework;
  extraction: ExtractionResult;
  originalCounts: { routes: number; types: number; schemas: number };
}

const DEFAULT_MAX_ENTRIES_PER_KIND = 100;

/**
 * Default "public API surface" globs for shared-types extraction.
 * Covers the common conventions for exposing types meant to be consumed
 * across a project boundary. Implementation files (utils, components,
 * hooks, handlers, etc.) are deliberately excluded so shared-types.json
 * stays focused on what connected projects actually need to know.
 */
const DEFAULT_SHARED_TYPES_GLOBS = [
  '**/types.ts',
  '**/types.tsx',
  '**/types/**/*.ts',
  '**/types/**/*.tsx',
  '**/schema.ts',
  '**/schemas/**/*.ts',
  '**/models.ts',
  '**/models/**/*.ts',
  '**/contracts/**/*.ts',
  '**/contracts/**/*.tsx',
  '**/shared/**/*.ts',
  '**/shared/**/*.tsx',
  '**/api-types.ts',
  '**/api/types.ts',
  '**/dto.ts',
  '**/dtos/**/*.ts',
  // Root barrel indexes — `src/index.ts`, `index.ts`, `src/lib/index.ts`, etc.
  'index.ts',
  'src/index.ts',
  'src/lib/index.ts',
  'lib/index.ts',
];

const TEST_FILE_PATTERNS = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/__tests__/**',
  '**/test/**',
  '**/tests/**',
  '**/__mocks__/**',
];

const INTERNAL_NAME_PATTERNS = [
  /^_/,           // _Foo, _internal
  /^Internal/,
  /^Private/,
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
 * Parse the header of a thread file. Threads look like:
 *
 * ```
 * # Thread: <subject>
 *
 * **From:** <project>
 * **To:** <project> | <project, project> | all
 * **Started:** <ISO timestamp>
 * **Status:** open | resolved
 *
 * ## <project> @ <timestamp>
 * ...message...
 * ```
 *
 * Everything is optional — missing fields fall back to defaults so an
 * index can always be rendered.
 */
function parseThreadHeader(content: string): {
  from: string;
  to: 'all' | string[];
  status: string;
  lastSpeaker: string | null;
} {
  const field = (label: string): string | undefined => {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+)`, 'i');
    const m = content.match(re);
    return m ? m[1].trim() : undefined;
  };

  const from = field('From') ?? field('Started by') ?? 'unknown';
  const status = (field('Status') ?? 'open').toLowerCase();
  const toRaw = field('To') ?? 'all';
  const to: 'all' | string[] =
    toRaw.toLowerCase() === 'all'
      ? 'all'
      : toRaw.split(',').map((s) => s.trim()).filter(Boolean);

  const messageHeadings = [...content.matchAll(/^##\s+(.+?)\s*@\s*.+$/gm)];
  const lastSpeaker = messageHeadings.length > 0
    ? messageHeadings[messageHeadings.length - 1][1].trim()
    : null;

  return { from, to, status, lastSpeaker };
}

/**
 * Count checklist items in a thread. Supports both `- [ ]` / `- [x]`
 * (spec-compliant) and `* [ ]` / `* [x]` (alternative). The index shows
 * progress as `done/total`, or `✓` when all done, or `—` when there are
 * no checklist items at all.
 */
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

export class MemoryWriter {
  /**
   * Scan all connected projects and write memory files everywhere.
   * Returns scan results for CLI output.
   */
  static async sync(
    projectRoot: string,
    onProjectStart?: (name: string) => void,
    onProjectResult?: (name: string, result: ExtractionResult, framework: Framework) => void
  ): Promise<{
    projects: ProjectScanResult[];
    totalRoutes: number;
    totalTypes: number;
    totalSchemas: number;
    updatedConfigs: Map<string, string[]>;
  }> {
    const resolvedRoot = path.resolve(projectRoot);
    const allRoots = ConnectionManager.getAllProjectRoots(resolvedRoot);

    // Phase 1: Scan all projects
    const scanResults: ProjectScanResult[] = [];
    const allRoutes: ExtractedRoute[] = [];
    const allTypes: ExtractedType[] = [];
    const allSchemas: ExtractedSchema[] = [];

    for (const root of allRoots) {
      const name = ConnectionManager.getProjectName(root);
      onProjectStart?.(name);

      const config = ConnectionManager.readConfig(root);
      const framework = detectFramework(root);
      const raw = await MemoryWriter.scanProject(root, config, framework, name);

      const cap = config.maxEntriesPerKind ?? DEFAULT_MAX_ENTRIES_PER_KIND;
      const originalCounts = {
        routes: raw.routes.length,
        types: raw.types.length,
        schemas: raw.schemas.length,
      };
      const extraction: ExtractionResult = {
        framework: raw.framework,
        routes: raw.routes.slice(0, cap),
        types: raw.types.slice(0, cap),
        schemas: raw.schemas.slice(0, cap),
      };

      allRoutes.push(...extraction.routes);
      allTypes.push(...extraction.types);
      allSchemas.push(...extraction.schemas);

      scanResults.push({ name, root, framework, extraction, originalCounts });
      onProjectResult?.(name, extraction, framework);
    }

    const originalTotals = scanResults.reduce(
      (acc, r) => ({
        routes: acc.routes + r.originalCounts.routes,
        types: acc.types + r.originalCounts.types,
        schemas: acc.schemas + r.originalCounts.schemas,
      }),
      { routes: 0, types: 0, schemas: 0 }
    );
    const truncated = {
      routes: originalTotals.routes > allRoutes.length,
      types: originalTotals.types > allTypes.length,
      schemas: originalTotals.schemas > allSchemas.length,
    };

    // Phase 2: Write memory to every project
    const now = new Date().toISOString();
    const updatedConfigs = new Map<string, string[]>();

    for (const root of allRoots) {
      const name = ConnectionManager.getProjectName(root);
      const connections = ConnectionManager.readConnections(root);
      const connectionsWithFramework = connections.connections.map((conn) => {
        const scanResult = scanResults.find((s) => s.root === conn.path);
        return { ...conn, framework: scanResult?.framework ?? null };
      });

      await MemoryWriter.writeMemoryFiles(root, name, {
        routes: allRoutes,
        types: allTypes,
        schemas: allSchemas,
        connections: connectionsWithFramework,
        now,
        truncated,
        originalTotals,
      });

      // Phase 3: Update agent config files
      const updated = AgentConfigInjector.inject(root);
      if (updated.length > 0) {
        updatedConfigs.set(name, updated);
      }
    }

    // Phase 4: Propagate threads (the single cross-project message primitive)
    // across all connected projects and regenerate per-project _index.md so
    // agents can scan for what's addressed to them without opening every file.
    MemoryWriter.propagateThreads(allRoots);
    MemoryWriter.regenerateThreadIndexes(allRoots);

    return {
      projects: scanResults,
      totalRoutes: allRoutes.length,
      totalTypes: allTypes.length,
      totalSchemas: allSchemas.length,
      updatedConfigs,
    };
  }

  /**
   * Scan a single project and extract routes, types, and schemas.
   */
  private static async scanProject(
    root: string,
    config: GromeConfig,
    framework: Framework,
    projectName: string
  ): Promise<ExtractionResult> {
    const scanner = new Scanner(root, config);
    const routes: ExtractedRoute[] = [];
    const types: ExtractedType[] = [];
    const schemas: ExtractedSchema[] = [];

    const sharedTypesGlobs = config.extractors.sharedTypesGlobs ?? DEFAULT_SHARED_TYPES_GLOBS;

    // Get scannable files
    const files = await scanner.scan();

    for (const relPath of files) {
      const absPath = path.join(root, relPath);

      // Only read text files we can extract from
      if (!relPath.match(/\.(ts|js|tsx|jsx|prisma)$/)) continue;

      // Routes and schemas still scan all files; shared-types extraction
      // is restricted to files that match a public-surface glob (and skips
      // test files), so shared-types.json stays focused on cross-project API
      // shape rather than every exported interface in the codebase.
      const isTestFile = micromatch.isMatch(relPath, TEST_FILE_PATTERNS);
      const isSharedTypeFile = !isTestFile &&
        micromatch.isMatch(relPath, sharedTypesGlobs);

      let content: string;
      try {
        content = fs.readFileSync(absPath, 'utf-8');
      } catch {
        continue; // Skip unreadable files
      }

      if (config.extractors.routes) {
        routes.push(...extractRoutes(content, relPath, projectName, framework));
      }

      if (config.extractors.types && isSharedTypeFile && relPath.match(/\.(ts|tsx)$/)) {
        const fileTypes = extractTypes(content, relPath, projectName).filter(
          (t) => !INTERNAL_NAME_PATTERNS.some((re) => re.test(t.name))
        );
        types.push(...fileTypes);
      }

      if (config.extractors.schemas) {
        schemas.push(...extractSchemas(content, relPath, projectName));
      }
    }

    return { routes, types, schemas, framework };
  }

  /**
   * Write all memory files to a project's .grome/memory/ directory.
   */
  private static async writeMemoryFiles(
    projectRoot: string,
    projectName: string,
    data: {
      routes: ExtractedRoute[];
      types: ExtractedType[];
      schemas: ExtractedSchema[];
      connections: Array<Connection & { framework: Framework }>;
      now: string;
      truncated: { routes: boolean; types: boolean; schemas: boolean };
      originalTotals: { routes: number; types: number; schemas: number };
    }
  ): Promise<void> {
    const memoryDir = ConnectionManager.getMemoryDir(projectRoot);
    ensureDir(memoryDir);

    // route-map.json
    const routeMap: RouteMapFile = {
      version: 1,
      generatedAt: data.now,
      routes: data.routes,
      ...(data.truncated.routes && {
        truncated: true,
        originalCount: data.originalTotals.routes,
      }),
    };
    await atomicWrite(
      path.join(memoryDir, 'route-map.json'),
      JSON.stringify(routeMap, null, 2)
    );

    // shared-types.json
    const sharedTypes: SharedTypesFile = {
      version: 1,
      generatedAt: data.now,
      types: data.types,
      ...(data.truncated.types && {
        truncated: true,
        originalCount: data.originalTotals.types,
      }),
    };
    await atomicWrite(
      path.join(memoryDir, 'shared-types.json'),
      JSON.stringify(sharedTypes, null, 2)
    );

    // api-schemas.json
    const apiSchemas: ApiSchemasFile = {
      version: 1,
      generatedAt: data.now,
      schemas: data.schemas,
      ...(data.truncated.schemas && {
        truncated: true,
        originalCount: data.originalTotals.schemas,
      }),
    };
    await atomicWrite(
      path.join(memoryDir, 'api-schemas.json'),
      JSON.stringify(apiSchemas, null, 2)
    );

    // project-manifest.json
    const manifest: ProjectManifest = {
      version: 1,
      generatedAt: data.now,
      thisProject: projectName,
      connections: data.connections,
      stats: {
        routes: data.routes.length,
        types: data.types.length,
        schemas: data.schemas.length,
      },
    };
    await atomicWrite(
      path.join(memoryDir, 'project-manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    // README.md
    const connectedNames = data.connections.map((c) => c.name).join(', ') || 'none';
    const readme = `# Grome Shared Memory

Cross-project context generated by Grome Connect.
Do not edit — overwritten on each sync.

## Files
- route-map.json — API routes from connected projects
- shared-types.json — TypeScript types and interfaces
- api-schemas.json — Validation schemas (Zod, Prisma)
- project-manifest.json — Connection metadata

## Usage
Read these files to understand the API surface of connected projects.
Use route-map.json for endpoint paths and methods.
Use shared-types.json for response/request type shapes.

Last synced: ${data.now}
Connected projects: ${connectedNames}
`;
    await atomicWrite(path.join(memoryDir, 'README.md'), readme);
  }

  /**
   * Propagate thread files (`.grome/threads/*.md`) across every
   * connected project. Threads are the single cross-project message
   * primitive — announcements, questions, multi-turn discussions, all
   * collapse here. Propagation is mtime-wins: the newest copy of a given
   * filename overwrites older copies in every other project.
   */
  private static propagateThreads(allRoots: string[]): void {
    type Entry = { absPath: string; mtimeMs: number };
    const byName = new Map<string, Entry>();

    // Collect only from projects that have threads enabled — a disabled
    // project's locally-authored threads don't propagate outward.
    for (const root of allRoots) {
      if (!threadsEnabled(root)) continue;
      const dir = path.join(ConnectionManager.getGromeDir(root), 'threads');
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.md') || name === '_index.md') continue;
        const absPath = path.join(dir, name);
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(absPath).mtimeMs; } catch { continue; }
        const prev = byName.get(name);
        if (!prev || mtimeMs > prev.mtimeMs) byName.set(name, { absPath, mtimeMs });
      }
    }

    if (byName.size === 0) return;

    // Write only to projects that have threads enabled — threads don't
    // land in a disabled project's dir even if peers have them.
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
   * Regenerate `_index.md` in every project's threads dir. One table per
   * project, filtered to threads addressed to that project (or `all`),
   * sorted by last-activity. Columns: thread, from, to, status, progress
   * (checklist completion), last speaker.
   *
   * Source of truth is always the individual `.md` files. This index is
   * pure projection and safe to regenerate every sync.
   */
  private static regenerateThreadIndexes(allRoots: string[]): void {
    for (const root of allRoots) {
      if (!threadsEnabled(root)) continue;
      const projectName = ConnectionManager.getProjectName(root);
      const dir = path.join(ConnectionManager.getGromeDir(root), 'threads');
      if (!fs.existsSync(dir)) continue;

      type Row = { mtimeMs: number; line: string };
      const rows: Row[] = [];

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
        const targetsThisProject =
          parsed.to === 'all' || parsed.to.includes(projectName);
        if (!targetsThisProject) continue;

        const { done, total } = countChecklist(content);
        const progress = total === 0 ? '—' : done === total ? '✓' : `${done}/${total}`;
        const toLabel = parsed.to === 'all' ? 'all' : parsed.to.join(', ');

        rows.push({
          mtimeMs,
          line: `| [\`${name}\`](./${name}) | ${parsed.from} | ${toLabel} | ${parsed.status} | ${progress} | ${parsed.lastSpeaker ?? '—'} |`,
        });
      }

      rows.sort((a, b) => b.mtimeMs - a.mtimeMs);

      const body = rows.length > 0
        ? [
          `# Threads for \`${projectName}\``,
          '',
          '> Auto-generated by `grome sync`. Source of truth is the individual `.md` files.',
          '> Append messages, flip checklist boxes, or change `**Status:**` in each file;',
          '> this index will reflect the change on the next sync.',
          '',
          '| Thread | From | To | Status | Progress | Last speaker |',
          '| ------ | ---- | -- | ------ | -------- | ------------ |',
          ...rows.map((r) => r.line),
          '',
        ].join('\n')
        : [
          `# Threads for \`${projectName}\``,
          '',
          'No threads addressed to this project.',
          '',
        ].join('\n');

      try { fs.writeFileSync(path.join(dir, '_index.md'), body); } catch { /* skip */ }
    }
  }

  /**
   * Clear memory files from a project.
   */
  static async clearMemory(projectRoot: string): Promise<void> {
    const memoryDir = ConnectionManager.getMemoryDir(projectRoot);
    if (!fs.existsSync(memoryDir)) return;

    const files = ['route-map.json', 'shared-types.json', 'api-schemas.json', 'project-manifest.json', 'README.md'];
    for (const file of files) {
      const filePath = path.join(memoryDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }
}
