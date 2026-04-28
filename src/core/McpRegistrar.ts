import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWrite } from '../utils.js';

/**
 * Manages `.mcp.json` at the repo root. This is the project-scoped MCP
 * config file that Claude Code actually reads (confirmed via Codex/Claude
 * smoke tests — `.claude/settings.json` mcpServers does NOT register).
 *
 * Write policy:
 * - Plain JSON (no comments), parsed and serialised with JSON.parse /
 *   JSON.stringify. No jsonc-parser dep needed.
 * - Our block is written under `mcpServers.grome` with a sentinel
 *   `_gromeManaged: true` so we can distinguish our entry from a
 *   user-hand-added block with the same key.
 * - If `mcpServers.grome` exists without our sentinel, we do NOT
 *   clobber — we leave it alone and report `managed: false`.
 * - Removal only fires when the sentinel is present.
 */

export const SENTINEL_KEY = '_gromeManaged';
export const SERVER_KEY = 'grome';

export interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [k: string]: unknown;
}

export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  [SENTINEL_KEY]?: boolean;
  [k: string]: unknown;
}

export interface RegisterOptions {
  /**
   * Override the command invocation. Defaults to `npx -y grome-connect mcp`.
   * Use `{ command: 'node', args: ['/abs/path/dist/cli.cjs', 'mcp'] }` for
   * local dev.
   */
  command?: string;
  args?: string[];
}

export interface RegisterResult {
  path: string;
  action: 'created' | 'updated' | 'unchanged' | 'skipped-user-managed';
  existed: boolean;
}

export interface UnregisterResult {
  path: string;
  action: 'removed' | 'not-present' | 'skipped-user-managed' | 'file-missing';
}

function mcpJsonPath(projectRoot: string): string {
  return path.join(projectRoot, '.mcp.json');
}

function readMcpJson(filePath: string): McpConfig {
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw) as McpConfig;
  } catch (err) {
    throw new Error(
      `Failed to parse ${filePath}: ${(err as Error).message}. ` +
      `This file must be valid JSON. Fix by hand or delete to regenerate.`
    );
  }
}

function defaultEntry(opts: RegisterOptions = {}): McpServerEntry {
  return {
    command: opts.command ?? 'npx',
    args: opts.args ?? ['-y', 'grome-connect@latest', 'mcp'],
    [SENTINEL_KEY]: true,
  };
}

function entriesEqual(a: McpServerEntry, b: McpServerEntry): boolean {
  return (
    a.command === b.command &&
    JSON.stringify(a.args ?? []) === JSON.stringify(b.args ?? []) &&
    a[SENTINEL_KEY] === b[SENTINEL_KEY]
  );
}

export const McpRegistrar = {
  path: mcpJsonPath,

  /**
   * Register the grome MCP server in `.mcp.json`.
   *
   * - If the file doesn't exist → create it with just our block.
   * - If `mcpServers.grome` is absent → add it (managed).
   * - If `mcpServers.grome` is present WITH our sentinel → refresh it
   *   idempotently (no write if identical).
   * - If `mcpServers.grome` is present WITHOUT our sentinel → leave
   *   alone, return `skipped-user-managed`.
   */
  async register(projectRoot: string, opts: RegisterOptions = {}): Promise<RegisterResult> {
    const filePath = mcpJsonPath(projectRoot);
    const existed = fs.existsSync(filePath);
    const config = readMcpJson(filePath);
    const existing = config.mcpServers?.[SERVER_KEY];

    if (existing && existing[SENTINEL_KEY] !== true) {
      return { path: filePath, action: 'skipped-user-managed', existed };
    }

    const desired = defaultEntry(opts);
    if (existing && entriesEqual(existing, desired)) {
      return { path: filePath, action: 'unchanged', existed };
    }

    config.mcpServers = { ...(config.mcpServers ?? {}), [SERVER_KEY]: desired };
    await atomicWrite(filePath, JSON.stringify(config, null, 2) + '\n');

    return { path: filePath, action: existed ? 'updated' : 'created', existed };
  },

  /**
   * Remove the grome MCP server block iff the sentinel matches.
   * Leaves the file (and any other mcpServers entries) intact; only
   * removes the file entirely if this leaves it empty.
   */
  async unregister(projectRoot: string): Promise<UnregisterResult> {
    const filePath = mcpJsonPath(projectRoot);
    if (!fs.existsSync(filePath)) return { path: filePath, action: 'file-missing' };

    const config = readMcpJson(filePath);
    const existing = config.mcpServers?.[SERVER_KEY];

    if (!existing) return { path: filePath, action: 'not-present' };
    if (existing[SENTINEL_KEY] !== true) {
      return { path: filePath, action: 'skipped-user-managed' };
    }

    delete config.mcpServers![SERVER_KEY];
    if (Object.keys(config.mcpServers!).length === 0) delete config.mcpServers;

    if (Object.keys(config).length === 0) {
      fs.unlinkSync(filePath);
    } else {
      await atomicWrite(filePath, JSON.stringify(config, null, 2) + '\n');
    }

    return { path: filePath, action: 'removed' };
  },

  /** Inspect without mutating. Useful for `grome status`. */
  inspect(projectRoot: string): { present: boolean; managed: boolean; entry?: McpServerEntry } {
    const filePath = mcpJsonPath(projectRoot);
    if (!fs.existsSync(filePath)) return { present: false, managed: false };
    const config = readMcpJson(filePath);
    const entry = config.mcpServers?.[SERVER_KEY];
    if (!entry) return { present: false, managed: false };
    return { present: true, managed: entry[SENTINEL_KEY] === true, entry };
  },
};
