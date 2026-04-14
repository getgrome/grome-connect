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
 * Parse the header fields out of a markdown handoff. The format is
 * permissive — we expect a `# Title`, then bold-labeled fields like
 * `**From:**`, `**To:**`, `**Type:**`. Missing fields fall back to
 * sensible defaults so an index can still be rendered.
 */
function parseHandoffHeader(content: string): {
  from: string;
  to: 'all' | string[];
  type: string;
  summary: string;
} {
  const field = (label: string): string | undefined => {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+)`, 'i');
    const m = content.match(re);
    return m ? m[1].trim() : undefined;
  };

  const from = field('From') ?? 'unknown';
  const type = field('Type') ?? 'note';
  const toRaw = field('To') ?? 'all';

  const to: 'all' | string[] =
    toRaw.toLowerCase() === 'all'
      ? 'all'
      : toRaw.split(',').map((s) => s.trim()).filter(Boolean);

  // Summary: first non-heading, non-blank line after the header block,
  // truncated for the table.
  const lines = content.split('\n');
  let summary = '';
  let inHeader = true;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (inHeader) {
      if (trimmed.startsWith('#') || trimmed.startsWith('**')) continue;
      inHeader = false;
    }
    if (
      trimmed.startsWith('#') ||
      trimmed.startsWith('>') ||
      trimmed.startsWith('|') ||
      trimmed.startsWith('-')
    ) continue;
    summary = trimmed;
    break;
  }
  if (summary.length > 140) summary = summary.slice(0, 137) + '...';

  return { from, to, type, summary: summary || '—' };
}

/**
 * Read the per-recipient tracking row for a project out of a handoff's
 * markdown table. Expected format near the bottom of the file:
 *
 * ```
 * | Project  | Read | Done |
 * | -------- | ---- | ---- |
 * | grome    | [x]  | [ ]  |
 * | getgrome | [ ]  | [ ]  |
 * ```
 *
 * If the project isn't in the table (or the table is missing), both
 * values are reported as false — the file is effectively unread.
 */
function readTrackingRow(
  content: string,
  projectName: string
): { read: boolean; implemented: boolean } {
  const lines = content.split('\n');
  const rowRe = new RegExp(`^\\|\\s*${escapeForRegex(projectName)}\\s*\\|`, 'i');
  for (const line of lines) {
    if (!rowRe.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim());
    // cells[0] is '' before first |, cells[1] is project, cells[2] is read, cells[3] is done
    const read = /\[\s*x\s*\]/i.test(cells[2] ?? '');
    const implemented = /\[\s*x\s*\]/i.test(cells[3] ?? '');
    return { read, implemented };
  }
  return { read: false, implemented: false };
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

    // Phase 4: Propagate user-written markdown handoffs across all projects,
    // then regenerate per-project _index.md so agents can quickly find the
    // handoffs addressed to them without opening every file.
    MemoryWriter.propagateMarkdownHandoffs(allRoots);
    MemoryWriter.regenerateHandoffIndexes(allRoots);

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
   * Collect every `.md` handoff across all projects and copy any that are
   * missing in a target project. Uses modified-time as a tiebreaker when a
   * filename exists in multiple projects.
   */
  private static propagateMarkdownHandoffs(allRoots: string[]): void {
    type Entry = { absPath: string; mtimeMs: number };
    const byName = new Map<string, Entry>();

    for (const root of allRoots) {
      const dir = path.join(ConnectionManager.getMemoryDir(root), 'handoffs');
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.md')) continue;
        const absPath = path.join(dir, name);
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(absPath).mtimeMs; } catch { continue; }
        const prev = byName.get(name);
        if (!prev || mtimeMs > prev.mtimeMs) {
          byName.set(name, { absPath, mtimeMs });
        }
      }
    }

    if (byName.size === 0) return;

    for (const root of allRoots) {
      const dir = path.join(ConnectionManager.getMemoryDir(root), 'handoffs');
      ensureDir(dir);
      for (const [name, entry] of byName) {
        const target = path.join(dir, name);
        if (target === entry.absPath) continue;
        try {
          const existing = fs.existsSync(target) ? fs.statSync(target).mtimeMs : -1;
          if (entry.mtimeMs > existing) {
            fs.copyFileSync(entry.absPath, target);
          }
        } catch { /* skip unreadable */ }
      }
    }
  }

  /**
   * Regenerate `_index.md` in every project's handoffs directory. The index
   * is a filtered table showing only handoffs addressed to that project (or
   * `all`), so agents can answer "is there a handoff for me?" without
   * opening every file. Source of truth is the individual `.md` files; the
   * index is fully derived and safe to re-generate on every sync.
   */
  private static regenerateHandoffIndexes(allRoots: string[]): void {
    for (const root of allRoots) {
      const projectName = ConnectionManager.getProjectName(root);
      const dir = path.join(ConnectionManager.getMemoryDir(root), 'handoffs');
      if (!fs.existsSync(dir)) continue;

      const rows: string[] = [];
      for (const name of fs.readdirSync(dir).sort()) {
        if (!name.endsWith('.md') || name === '_index.md') continue;
        const absPath = path.join(dir, name);
        let content: string;
        try { content = fs.readFileSync(absPath, 'utf-8'); } catch { continue; }

        const parsed = parseHandoffHeader(content);
        const targetsThisProject =
          parsed.to === 'all' || parsed.to.includes(projectName);
        if (!targetsThisProject) continue;

        const status = readTrackingRow(content, projectName);
        const toLabel = parsed.to === 'all' ? 'all' : parsed.to.join(', ');
        rows.push(
          `| [\`${name}\`](./${name}) | ${parsed.from} | ${toLabel} | ${parsed.type} | ${
            parsed.summary.replace(/\|/g, '\\|')
          } | ${status.read ? 'x' : ' '} | ${status.implemented ? 'x' : ' '} |`
        );
      }

      const body = rows.length > 0
        ? [
          `# Handoffs for \`${projectName}\``,
          '',
          '> Auto-generated by `grome sync`. Do not edit — re-run sync to refresh.',
          '> Source of truth is the individual `.md` files. Update the tracking',
          '> table inside each handoff when you read or implement it; this index',
          '> will reflect the change on the next sync.',
          '',
          '| Handoff | From | To | Type | Summary | Read | Done |',
          '| ------- | ---- | -- | ---- | ------- | ---- | ---- |',
          ...rows,
          '',
        ].join('\n')
        : [
          `# Handoffs for \`${projectName}\``,
          '',
          'No open handoffs addressed to this project.',
          '',
        ].join('\n');

      try {
        fs.writeFileSync(path.join(dir, '_index.md'), body);
      } catch { /* skip */ }
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
