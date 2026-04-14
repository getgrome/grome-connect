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
  };
  /** Per-project soft limit on extracted entities. Default 500. */
  maxEntriesPerKind?: number;
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
  thisProject: string;
  connections: Array<Connection & { framework: string | null }>;
  stats: {
    routes: number;
    types: number;
    schemas: number;
  };
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
