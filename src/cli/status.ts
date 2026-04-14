import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConnectionManager } from '../core/ConnectionManager.js';
import { color, symbols, timeAgo } from '../utils.js';

export async function statusCommand(): Promise<void> {
  const projectRoot = path.resolve(process.cwd());

  if (!ConnectionManager.isInitialized(projectRoot)) {
    console.error(`\n  ${symbols.error} ${color.red('Not initialized.')} Run ${color.cyan('grome init')} first.\n`);
    process.exit(1);
  }

  const projectName = ConnectionManager.getProjectName(projectRoot);
  const connections = ConnectionManager.readConnections(projectRoot);
  const memoryDir = ConnectionManager.getMemoryDir(projectRoot);

  console.log(`\n${color.bold(projectName)}`);

  if (connections.connections.length === 0) {
    console.log(`  ${color.dim('No connections. Run')} ${color.cyan('grome link <path>')} ${color.dim('to connect a project.')}\n`);
    return;
  }

  // Show connections
  for (const conn of connections.connections) {
    const exists = fs.existsSync(conn.path);

    if (exists) {
      console.log(
        `  ${symbols.arrow} ${color.bold(conn.name)}    linked ${timeAgo(conn.linked)}    path: ${color.dim(conn.path)}`
      );
    } else {
      console.log(
        `  ${symbols.error} ${color.bold(conn.name)}    ${color.red('path not found:')} ${conn.path}`
      );
      console.log(`    Run ${color.cyan('grome link <new-path>')} to update.`);
    }
  }

  // Show memory stats
  const manifestPath = path.join(memoryDir, 'project-manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const stats = manifest.stats || {};

      console.log(
        `\n  Memory: ${stats.routes || 0} routes, ${stats.types || 0} types, ${stats.schemas || 0} schemas`
      );
      console.log(`  Last sync: ${timeAgo(manifest.generatedAt)}`);

      // Check if files changed since last sync
      const syncTime = new Date(manifest.generatedAt).getTime();
      let changedFiles = 0;

      for (const conn of connections.connections) {
        if (!fs.existsSync(conn.path)) continue;
        changedFiles += countChangedFiles(conn.path, syncTime);
      }
      changedFiles += countChangedFiles(projectRoot, syncTime);

      if (changedFiles > 0) {
        console.log(
          `  ${symbols.warning} ${color.yellow(`${changedFiles} files changed since last sync.`)} Run ${color.cyan('grome sync')} to update.`
        );
      }
    } catch {
      console.log(`\n  ${color.dim('Memory files not found. Run')} ${color.cyan('grome sync')}${color.dim('.')}`);
    }
  } else {
    console.log(`\n  ${color.dim('No memory files yet. Run')} ${color.cyan('grome sync')}${color.dim('.')}`);
  }

  console.log();
}

/**
 * Count source files that changed after a given timestamp.
 * Quick heuristic — just checks a few key directories.
 */
function countChangedFiles(root: string, sinceMtime: number): number {
  let count = 0;
  const checkDirs = ['src', 'app', 'pages', 'lib', 'prisma'];

  for (const dir of checkDirs) {
    const dirPath = path.join(root, dir);
    if (!fs.existsSync(dirPath)) continue;

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.match(/\.(ts|js|tsx|jsx|prisma)$/)) continue;

        const stat = fs.statSync(path.join(dirPath, entry.name));
        if (stat.mtimeMs > sinceMtime) count++;
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return count;
}
