import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConnectionManager } from './ConnectionManager.js';
import type { ExtractedRoute, ExtractedType, ExtractedSchema, Handoff } from '../types.js';
import { ensureDir } from '../utils.js';

const HANDOFFS_DIR = 'handoffs';
const PREVIOUS_SNAPSHOT = '.last-sync.json';
const MAX_ACTIVE_HANDOFFS = 5;
const HANDOFF_EXPIRY_DAYS = 7;

interface SyncSnapshot {
  routes: ExtractedRoute[];
  types: ExtractedType[];
  schemas: ExtractedSchema[];
  timestamp: string;
}

interface DiffResult {
  addedRoutes: ExtractedRoute[];
  removedRoutes: ExtractedRoute[];
  changedRoutes: { old: ExtractedRoute; new: ExtractedRoute }[];
  addedTypes: ExtractedType[];
  removedTypes: ExtractedType[];
  changedTypes: { old: ExtractedType; new: ExtractedType }[];
  addedSchemas: ExtractedSchema[];
  removedSchemas: ExtractedSchema[];
  changedSchemas: { old: ExtractedSchema; new: ExtractedSchema }[];
}

export class AutoHandoff {
  /**
   * Compare current extraction results against previous snapshot.
   * Generate handoffs for meaningful changes, then save new snapshot.
   */
  static async processSync(
    projectRoot: string,
    routes: ExtractedRoute[],
    types: ExtractedType[],
    schemas: ExtractedSchema[],
  ): Promise<Handoff[]> {
    const gromeDir = ConnectionManager.getGromeDir(projectRoot);
    const snapshotPath = path.join(gromeDir, PREVIOUS_SNAPSHOT);

    // Read previous snapshot
    let previous: SyncSnapshot | null = null;
    try {
      if (fs.existsSync(snapshotPath)) {
        previous = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      }
    } catch { /* first sync */ }

    // Save current snapshot for next comparison
    const current: SyncSnapshot = {
      routes,
      types,
      schemas,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(snapshotPath, JSON.stringify(current, null, 2));

    // First sync — no previous data to diff against
    if (!previous) return [];

    // Diff
    const diff = AutoHandoff.diff(previous, current);

    // Generate handoffs from meaningful changes
    const handoffs = AutoHandoff.generateHandoffs(projectRoot, diff);

    // Clean up expired handoffs
    AutoHandoff.cleanupExpired(projectRoot);

    // Distribute handoffs to connected projects
    for (const handoff of handoffs) {
      AutoHandoff.distribute(projectRoot, handoff);
    }

    return handoffs;
  }

  private static diff(previous: SyncSnapshot, current: SyncSnapshot): DiffResult {
    return {
      addedRoutes: current.routes.filter(r => !previous.routes.some(p => p.method === r.method && p.path === r.path && p.source === r.source)),
      removedRoutes: previous.routes.filter(r => !current.routes.some(c => c.method === r.method && c.path === r.path && c.source === r.source)),
      changedRoutes: current.routes.filter(r => {
        const prev = previous.routes.find(p => p.method === r.method && p.path === r.path && p.source === r.source);
        return prev && (prev.response !== r.response || JSON.stringify(prev.params) !== JSON.stringify(r.params));
      }).map(r => ({
        new: r,
        old: previous.routes.find(p => p.method === r.method && p.path === r.path && p.source === r.source)!,
      })),

      addedTypes: current.types.filter(t => !previous.types.some(p => p.name === t.name && p.source === t.source)),
      removedTypes: previous.types.filter(t => !current.types.some(c => c.name === t.name && c.source === t.source)),
      changedTypes: current.types.filter(t => {
        const prev = previous.types.find(p => p.name === t.name && p.source === t.source);
        return prev && prev.definition !== t.definition;
      }).map(t => ({
        new: t,
        old: previous.types.find(p => p.name === t.name && p.source === t.source)!,
      })),

      addedSchemas: current.schemas.filter(s => !previous.schemas.some(p => p.name === s.name && p.source === s.source)),
      removedSchemas: previous.schemas.filter(s => !current.schemas.some(c => c.name === s.name && c.source === s.source)),
      changedSchemas: current.schemas.filter(s => {
        const prev = previous.schemas.find(p => p.name === s.name && p.source === s.source);
        return prev && JSON.stringify(prev.shape) !== JSON.stringify(s.shape);
      }).map(s => ({
        new: s,
        old: previous.schemas.find(p => p.name === s.name && p.source === s.source)!,
      })),
    };
  }

  private static generateHandoffs(projectRoot: string, diff: DiffResult): Handoff[] {
    const projectName = ConnectionManager.getProjectName(projectRoot);
    const now = new Date().toISOString();
    const handoffs: Handoff[] = [];

    const hasRouteChanges = diff.addedRoutes.length + diff.removedRoutes.length + diff.changedRoutes.length > 0;
    const hasTypeChanges = diff.addedTypes.length + diff.removedTypes.length + diff.changedTypes.length > 0;
    const hasSchemaChanges = diff.addedSchemas.length + diff.removedSchemas.length + diff.changedSchemas.length > 0;

    // No changes — no handoffs
    if (!hasRouteChanges && !hasTypeChanges && !hasSchemaChanges) return [];

    // Build a single concise handoff summarizing all changes
    const parts: string[] = [];
    const breakingChanges: string[] = [];
    const filesChanged = new Set<string>();

    // Route changes
    if (diff.addedRoutes.length > 0) {
      parts.push(`Added ${diff.addedRoutes.length} route(s): ${diff.addedRoutes.map(r => `${r.method} ${r.path}`).join(', ')}`);
      diff.addedRoutes.forEach(r => filesChanged.add(r.file));
    }
    if (diff.removedRoutes.length > 0) {
      parts.push(`Removed ${diff.removedRoutes.length} route(s): ${diff.removedRoutes.map(r => `${r.method} ${r.path}`).join(', ')}`);
      breakingChanges.push(...diff.removedRoutes.map(r => `${r.method} ${r.path} removed`));
      diff.removedRoutes.forEach(r => filesChanged.add(r.file));
    }
    if (diff.changedRoutes.length > 0) {
      parts.push(`Changed ${diff.changedRoutes.length} route(s): ${diff.changedRoutes.map(r => `${r.new.method} ${r.new.path}`).join(', ')}`);
      diff.changedRoutes.forEach(r => filesChanged.add(r.new.file));
    }

    // Type changes
    if (diff.addedTypes.length > 0) {
      parts.push(`Added ${diff.addedTypes.length} type(s): ${diff.addedTypes.map(t => t.name).join(', ')}`);
      diff.addedTypes.forEach(t => filesChanged.add(t.file));
    }
    if (diff.removedTypes.length > 0) {
      parts.push(`Removed ${diff.removedTypes.length} type(s): ${diff.removedTypes.map(t => t.name).join(', ')}`);
      breakingChanges.push(...diff.removedTypes.map(t => `type ${t.name} removed`));
      diff.removedTypes.forEach(t => filesChanged.add(t.file));
    }
    if (diff.changedTypes.length > 0) {
      parts.push(`Changed ${diff.changedTypes.length} type(s): ${diff.changedTypes.map(t => t.new.name).join(', ')}`);
      diff.changedTypes.forEach(t => filesChanged.add(t.new.file));
    }

    // Schema changes
    if (diff.addedSchemas.length > 0) {
      parts.push(`Added ${diff.addedSchemas.length} schema(s): ${diff.addedSchemas.map(s => s.name).join(', ')}`);
      diff.addedSchemas.forEach(s => filesChanged.add(s.file));
    }
    if (diff.removedSchemas.length > 0) {
      parts.push(`Removed ${diff.removedSchemas.length} schema(s): ${diff.removedSchemas.map(s => s.name).join(', ')}`);
      breakingChanges.push(...diff.removedSchemas.map(s => `schema ${s.name} removed`));
      diff.removedSchemas.forEach(s => filesChanged.add(s.file));
    }
    if (diff.changedSchemas.length > 0) {
      parts.push(`Changed ${diff.changedSchemas.length} schema(s): ${diff.changedSchemas.map(s => s.new.name).join(', ')}`);
      diff.changedSchemas.forEach(s => filesChanged.add(s.new.file));
    }

    const summary = parts.join('. ');
    const isBreaking = breakingChanges.length > 0;
    const id = `auto-${Date.now()}-${isBreaking ? 'breaking' : 'update'}`;

    const handoff: Handoff = {
      id,
      from: projectName,
      fromPath: projectRoot,
      type: isBreaking ? 'breaking-change' : 'feature-complete',
      summary: summary.length > 200 ? summary.slice(0, 197) + '...' : summary,
      context: {
        files_changed: [...filesChanged].slice(0, 20), // Cap at 20 files
        ...(breakingChanges.length > 0 ? { breaking_changes: breakingChanges.slice(0, 10) } : {}),
        notes: `Auto-generated by grome sync. Review route-map.json and shared-types.json for details.`,
      },
      status: 'open',
      created: now,
      acknowledged_by: [],
    };

    handoffs.push(handoff);
    return handoffs;
  }

  private static distribute(projectRoot: string, handoff: Handoff): void {
    const allRoots = ConnectionManager.getAllProjectRoots(projectRoot);
    const filename = `${handoff.id}.json`;

    for (const root of allRoots) {
      try {
        const handoffsDir = path.join(ConnectionManager.getMemoryDir(root), HANDOFFS_DIR);
        ensureDir(handoffsDir);
        fs.writeFileSync(path.join(handoffsDir, filename), JSON.stringify(handoff, null, 2));
      } catch { /* skip */ }
    }
  }

  /**
   * Remove handoffs older than HANDOFF_EXPIRY_DAYS or keep max MAX_ACTIVE_HANDOFFS.
   */
  private static cleanupExpired(projectRoot: string): void {
    const allRoots = ConnectionManager.getAllProjectRoots(projectRoot);
    const cutoff = Date.now() - (HANDOFF_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    for (const root of allRoots) {
      try {
        const handoffsDir = path.join(ConnectionManager.getMemoryDir(root), HANDOFFS_DIR);
        if (!fs.existsSync(handoffsDir)) continue;

        const files = fs.readdirSync(handoffsDir).filter(f => f.endsWith('.json')).sort();
        const toRemove: string[] = [];

        for (const file of files) {
          try {
            const handoff: Handoff = JSON.parse(fs.readFileSync(path.join(handoffsDir, file), 'utf-8'));
            const age = new Date(handoff.created).getTime();
            if (age < cutoff || handoff.status === 'done') {
              toRemove.push(file);
            }
          } catch {
            toRemove.push(file); // Remove malformed files
          }
        }

        // Also cap at MAX_ACTIVE_HANDOFFS (remove oldest first)
        const remaining = files.filter(f => !toRemove.includes(f));
        if (remaining.length > MAX_ACTIVE_HANDOFFS) {
          const excess = remaining.slice(0, remaining.length - MAX_ACTIVE_HANDOFFS);
          toRemove.push(...excess);
        }

        for (const file of toRemove) {
          try { fs.unlinkSync(path.join(handoffsDir, file)); } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  }
}
