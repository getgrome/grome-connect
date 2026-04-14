import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConnectionManager } from '../core/ConnectionManager.js';
import { SecretScanner } from '../core/SecretScanner.js';
import { color, symbols } from '../utils.js';
import type { Handoff } from '../types.js';

const HANDOFFS_DIR = 'handoffs';

/**
 * Create a new handoff that gets distributed to all connected projects.
 */
export async function handoffCommand(summary: string, options: {
  type?: string;
  files?: string;
  breaking?: string;
  deps?: string;
  env?: string;
  notes?: string;
} = {}): Promise<void> {
  const projectRoot = path.resolve(process.cwd());

  if (!ConnectionManager.isInitialized(projectRoot)) {
    console.error(`\n  ${symbols.error} ${color.red('Not initialized.')} Run ${color.cyan('grome init')} first.\n`);
    process.exit(1);
  }

  const config = ConnectionManager.readConfig(projectRoot);

  // Check if handoffs are enabled
  if (config.extractors.handoffs === false) {
    console.error(`\n  ${symbols.error} ${color.red('Handoffs are disabled.')} Enable in .grome/config.json → extractors.handoffs\n`);
    process.exit(1);
  }

  const projectName = ConnectionManager.getProjectName(projectRoot);
  const timestamp = new Date().toISOString();
  const id = `h-${Date.now()}-${summary.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;

  const handoff: Handoff = {
    id,
    from: projectName,
    fromPath: projectRoot,
    type: (options.type as Handoff['type']) || 'note',
    summary,
    context: {
      ...(options.files ? { files_changed: options.files.split(',').map(s => s.trim()) } : {}),
      ...(options.breaking ? { breaking_changes: options.breaking.split(',').map(s => s.trim()) } : {}),
      ...(options.deps ? { dependencies_added: options.deps.split(',').map(s => s.trim()) } : {}),
      ...(options.env ? { env_vars_added: options.env.split(',').map(s => s.trim()) } : {}),
      ...(options.notes ? { notes: options.notes } : {}),
    },
    status: 'open',
    created: timestamp,
    acknowledged_by: [],
  };

  // Scan for secrets and redact if found
  const secrets = SecretScanner.scan(handoff as unknown as Record<string, unknown>);
  if (secrets.length > 0) {
    // Redact secrets in the handoff object
    SecretScanner.redact(handoff as unknown as Record<string, unknown>);
    handoff.context.notes = [
      handoff.context.notes || '',
      `[REDACTED: ${secrets.length} potential secret(s) were removed from this handoff (${secrets.map(s => s.name).join(', ')}). Use env var names, not values.]`,
    ].filter(Boolean).join('\n');
    console.log(`\n  ${symbols.warning} ${color.yellow(`${secrets.length} potential secret(s) redacted:`)}`);
    for (const s of secrets) {
      console.log(`    ${color.yellow(s.name)} in ${color.bold(s.field)}`);
    }
  }

  // Clean env var fields — strip values from key=value patterns
  if (handoff.context.env_vars_added) {
    handoff.context.env_vars_added = handoff.context.env_vars_added.map(
      v => SecretScanner.looksLikeKeyValue(v) ? v.split('=')[0].trim() : v
    );
  }
  if (handoff.context.env_vars_removed) {
    handoff.context.env_vars_removed = handoff.context.env_vars_removed.map(
      v => SecretScanner.looksLikeKeyValue(v) ? v.split('=')[0].trim() : v
    );
  }

  // Write to local handoffs directory
  const memoryDir = ConnectionManager.getMemoryDir(projectRoot);
  const handoffsDir = path.join(memoryDir, HANDOFFS_DIR);
  if (!fs.existsSync(handoffsDir)) {
    fs.mkdirSync(handoffsDir, { recursive: true });
  }

  const filename = `${id}.json`;
  fs.writeFileSync(path.join(handoffsDir, filename), JSON.stringify(handoff, null, 2));
  console.log(`\n  ${symbols.success} ${color.bold('Handoff created:')} ${color.cyan(summary)}`);
  console.log(`  ${symbols.arrow} From: ${color.bold(projectName)}`);
  console.log(`  ${symbols.arrow} Type: ${handoff.type}`);
  console.log(`  ${symbols.arrow} File: ${color.dim(filename)}`);

  // Distribute to all connected projects
  const allRoots = ConnectionManager.getAllProjectRoots(projectRoot);
  let distributed = 0;

  for (const root of allRoots) {
    if (root === projectRoot) continue;
    try {
      const targetMemory = ConnectionManager.getMemoryDir(root);
      const targetHandoffs = path.join(targetMemory, HANDOFFS_DIR);
      if (!fs.existsSync(targetHandoffs)) {
        fs.mkdirSync(targetHandoffs, { recursive: true });
      }
      fs.writeFileSync(path.join(targetHandoffs, filename), JSON.stringify(handoff, null, 2));
      distributed++;
    } catch {
      console.log(`  ${symbols.warning} ${color.yellow('Could not write to')} ${color.dim(root)}`);
    }
  }

  console.log(`  ${symbols.arrow} Distributed to ${color.bold(String(distributed))} connected project${distributed !== 1 ? 's' : ''}`);
  console.log();
}

/**
 * List all handoffs visible to this project.
 */
export async function handoffListCommand(): Promise<void> {
  const projectRoot = path.resolve(process.cwd());

  if (!ConnectionManager.isInitialized(projectRoot)) {
    console.error(`\n  ${symbols.error} ${color.red('Not initialized.')} Run ${color.cyan('grome init')} first.\n`);
    process.exit(1);
  }

  const memoryDir = ConnectionManager.getMemoryDir(projectRoot);
  const handoffsDir = path.join(memoryDir, HANDOFFS_DIR);

  if (!fs.existsSync(handoffsDir)) {
    console.log(`\n  No handoffs yet. Create one with ${color.cyan('grome handoff "summary"')}\n`);
    return;
  }

  const files = fs.readdirSync(handoffsDir).filter(f => f.endsWith('.json')).sort().reverse();

  if (files.length === 0) {
    console.log(`\n  No handoffs yet. Create one with ${color.cyan('grome handoff "summary"')}\n`);
    return;
  }

  console.log(`\n  ${color.bold('Handoffs')} (${files.length})\n`);

  for (const file of files) {
    try {
      const handoff: Handoff = JSON.parse(fs.readFileSync(path.join(handoffsDir, file), 'utf-8'));
      const statusIcon = handoff.status === 'open' ? symbols.warning
        : handoff.status === 'acknowledged' ? symbols.arrow
        : symbols.success;
      const statusColor = handoff.status === 'open' ? color.yellow
        : handoff.status === 'done' ? color.green
        : color.dim;

      console.log(`  ${statusIcon} ${color.bold(handoff.summary)}`);
      console.log(`    From: ${color.cyan(handoff.from)} · ${handoff.type} · ${statusColor(handoff.status)}`);
      console.log(`    ${color.dim(new Date(handoff.created).toLocaleString())}`);
      if (handoff.context.breaking_changes?.length) {
        console.log(`    ${color.red('Breaking:')} ${handoff.context.breaking_changes.join(', ')}`);
      }
      console.log();
    } catch {
      // Skip malformed files
    }
  }
}

/**
 * Acknowledge a handoff (mark as seen by this project).
 */
export async function handoffAckCommand(handoffId: string): Promise<void> {
  const projectRoot = path.resolve(process.cwd());

  if (!ConnectionManager.isInitialized(projectRoot)) {
    console.error(`\n  ${symbols.error} ${color.red('Not initialized.')} Run ${color.cyan('grome init')} first.\n`);
    process.exit(1);
  }

  const projectName = ConnectionManager.getProjectName(projectRoot);
  const memoryDir = ConnectionManager.getMemoryDir(projectRoot);
  const handoffsDir = path.join(memoryDir, HANDOFFS_DIR);

  // Find the handoff file
  const files = fs.existsSync(handoffsDir) ? fs.readdirSync(handoffsDir).filter(f => f.includes(handoffId)) : [];
  if (files.length === 0) {
    console.error(`\n  ${symbols.error} ${color.red('Handoff not found:')} ${handoffId}\n`);
    process.exit(1);
  }

  const filePath = path.join(handoffsDir, files[0]);
  const handoff: Handoff = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  if (!handoff.acknowledged_by.includes(projectName)) {
    handoff.acknowledged_by.push(projectName);
  }
  handoff.status = 'acknowledged';

  fs.writeFileSync(filePath, JSON.stringify(handoff, null, 2));

  // Distribute the updated handoff to all connected projects
  const allRoots = ConnectionManager.getAllProjectRoots(projectRoot);
  for (const root of allRoots) {
    if (root === projectRoot) continue;
    try {
      const targetPath = path.join(ConnectionManager.getMemoryDir(root), HANDOFFS_DIR, files[0]);
      if (fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, JSON.stringify(handoff, null, 2));
      }
    } catch { /* skip */ }
  }

  console.log(`\n  ${symbols.success} Acknowledged: ${color.bold(handoff.summary)}\n`);
}

/**
 * Mark a handoff as done.
 */
export async function handoffDoneCommand(handoffId: string): Promise<void> {
  const projectRoot = path.resolve(process.cwd());

  if (!ConnectionManager.isInitialized(projectRoot)) {
    console.error(`\n  ${symbols.error} ${color.red('Not initialized.')} Run ${color.cyan('grome init')} first.\n`);
    process.exit(1);
  }

  const memoryDir = ConnectionManager.getMemoryDir(projectRoot);
  const handoffsDir = path.join(memoryDir, HANDOFFS_DIR);

  const files = fs.existsSync(handoffsDir) ? fs.readdirSync(handoffsDir).filter(f => f.includes(handoffId)) : [];
  if (files.length === 0) {
    console.error(`\n  ${symbols.error} ${color.red('Handoff not found:')} ${handoffId}\n`);
    process.exit(1);
  }

  const filePath = path.join(handoffsDir, files[0]);
  const handoff: Handoff = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  handoff.status = 'done';

  fs.writeFileSync(filePath, JSON.stringify(handoff, null, 2));

  // Distribute
  const allRoots = ConnectionManager.getAllProjectRoots(projectRoot);
  for (const root of allRoots) {
    if (root === projectRoot) continue;
    try {
      const targetPath = path.join(ConnectionManager.getMemoryDir(root), HANDOFFS_DIR, files[0]);
      if (fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, JSON.stringify(handoff, null, 2));
      }
    } catch { /* skip */ }
  }

  console.log(`\n  ${symbols.success} Done: ${color.bold(handoff.summary)}\n`);
}
