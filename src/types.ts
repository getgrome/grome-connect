// ── Config & Connections ──

export interface GromeConfig {
  version: number;
  projectId: string;
  deny: string[];
  allow?: string[];
  extractors: {
    routes: boolean;
    types: boolean;
    schemas: boolean;
    handoffs: boolean;
    /** Include `.d.ts` declaration files when extracting types. Default false. */
    declarationFiles?: boolean;
    /**
     * Globs that identify "public API surface" files for shared-types extraction.
     * Default: common type-declaration file conventions (types.ts, types/, schemas/,
     * models/, contracts/, shared/, barrel indexes). Set to `['**\/*.ts', '**\/*.tsx']`
     * to disable the filter and extract from every file.
     */
    sharedTypesGlobs?: string[];
  };
  /** Per-project soft limit on extracted entities. Default 100. */
  maxEntriesPerKind?: number;
  /**
   * When `false`, this project opts out of cross-project threads entirely:
   * the Threads section is omitted from its agent config injection, no
   * `_index.md` is generated, and threads neither propagate out from this
   * project nor land in this project's `threads/` dir. Peers with
   * `enableThreads: true` continue exchanging threads among themselves
   * normally. Existing files on disk are left untouched. Default `true`.
   */
  enableThreads?: boolean;
  /**
   * Override the project name used in thread headers, `_index.md`, memory
   * files, and injected agent-config blocks. When set, wins over
   * `package.json.name` and the folder basename. Useful when the repo's
   * `package.json.name` is an upstream identifier (e.g. `code-oss-dev`) but
   * the project should identify as something else (e.g. `grome`) across
   * threads and sync.
   */
  projectName?: string;
  /**
   * Effective list of agent-instruction files (filenames, not aliases) that
   * `grome sync` should inject the grome-connect section into. Created on
   * first sync if missing. When absent, sync falls back to "inject into any
   * detected files only, create none." Set/edited by `grome connect --agents`
   * and by the IDE's connect modal.
   */
  agentTargets?: string[];
}

export interface Connection {
  projectId: string;
  name: string;
  path: string;
  linked: string; // ISO timestamp
}

export interface ConnectionsFile {
  connections: Connection[];
}

// ── Extracted data ──

export interface ExtractedRoute {
  method: string;
  path: string;
  source: string;
  file: string;
  params: string[];
  response?: string;
  confidence: number;
}

export interface ExtractedType {
  name: string;
  source: string;
  file: string;
  definition: string;
  exported: boolean;
  confidence: number;
}

export interface ExtractedSchema {
  name: string;
  type: 'zod' | 'prisma';
  source: string;
  file: string;
  shape: Record<string, string>;
  confidence: number;
}

export interface ExtractionResult {
  routes: ExtractedRoute[];
  types: ExtractedType[];
  schemas: ExtractedSchema[];
  framework: string | null;
}

// ── Memory files ──

export interface RouteMapFile {
  version: number;
  generatedAt: string;
  routes: ExtractedRoute[];
  truncated?: boolean;
  originalCount?: number;
}

export interface SharedTypesFile {
  version: number;
  generatedAt: string;
  types: ExtractedType[];
  truncated?: boolean;
  originalCount?: number;
}

export interface ApiSchemasFile {
  version: number;
  generatedAt: string;
  schemas: ExtractedSchema[];
  truncated?: boolean;
  originalCount?: number;
}

export interface ProjectManifest {
  version: number;
  generatedAt: string;
  cliVersion?: string;
  thisProject: string;
  connections: Array<Connection & { framework: string | null; languages?: string[] }>;
}

// ── Handoffs ──

export interface Handoff {
  id: string;
  from: string;           // project name that created it
  fromPath: string;       // project root path
  type: 'feature-complete' | 'breaking-change' | 'dependency-update' | 'migration' | 'note';
  summary: string;        // one-line for agents to scan quickly
  context: {
    endpoints?: Array<{ method: string; path: string; request?: string; response?: string }>;
    files_changed?: string[];
    breaking_changes?: string[];
    dependencies_added?: string[];
    dependencies_removed?: string[];
    env_vars_added?: string[];
    env_vars_removed?: string[];
    migration_steps?: string[];
    notes?: string;
  };
  status: 'open' | 'acknowledged' | 'done';
  created: string;        // ISO timestamp
  acknowledged_by: string[];  // project names that have seen it
}

// ── Detection ──

export type Framework = 'express' | 'next' | 'fastify' | 'hono' | 'koa' | null;
