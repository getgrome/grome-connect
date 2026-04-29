import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConnectionManager } from '../core/ConnectionManager.js';
import { MemoryWriter } from '../core/MemoryWriter.js';
import { AgentConfigInjector } from '../core/AgentConfigInjector.js';
import { color, symbols } from '../utils.js';

export async function unlinkCommand(targetPath: string): Promise<void> {
  const sourceRoot = path.resolve(process.cwd());
  const targetRoot = path.resolve(targetPath);

  const sourceName = ConnectionManager.getProjectName(sourceRoot);

  if (!ConnectionManager.isInitialized(sourceRoot)) {
    console.error(`\n  ${symbols.error} ${color.red('Not initialized.')} Run ${color.cyan('grome init')} first.\n`);
    process.exit(1);
  }

  // Verify the connection exists
  const connections = ConnectionManager.readConnections(sourceRoot);
  const targetConn = connections.connections.find((c) => c.path === targetRoot);

  if (!targetConn) {
    // Try matching by name or partial path
    const byName = connections.connections.find(
      (c) => c.name === path.basename(targetRoot) || c.path.endsWith(targetPath)
    );
    if (byName) {
      console.log(`  ${color.dim(`Did you mean: ${byName.path}?`)}`);
    }
    console.error(`\n  ${symbols.error} ${color.red('Not connected to')} ${targetRoot}\n`);
    process.exit(1);
  }

  const targetName = targetConn.name;
  console.log(`\nUnlinking ${color.bold(sourceName)} ${symbols.arrow} ${color.bold(targetName)}...\n`);

  try {
    // Remove connection from both projects
    await ConnectionManager.unlink(sourceRoot, targetRoot);
    console.log(`  ${symbols.success} Removed connection`);

    // Clear memory
    await MemoryWriter.clearMemory(sourceRoot);
    if (fs.existsSync(targetRoot)) {
      await MemoryWriter.clearMemory(targetRoot);
    }
    console.log(`  ${symbols.success} Cleared memory files`);

    // Check remaining connections
    const remaining = ConnectionManager.readConnections(sourceRoot);

    if (remaining.connections.length > 0) {
      // Re-sync with remaining connections
      console.log(`\nRe-syncing remaining connections...\n`);
      await MemoryWriter.sync(sourceRoot);
      console.log(`  ${symbols.success} Re-synced ${remaining.connections.length} connection(s)`);
    } else {
      // No connections left — remove agent config injection
      const removedSource = AgentConfigInjector.remove(sourceRoot);
      for (const file of removedSource) {
        console.log(`  ${symbols.success} Removed Grome section from ${file} in ${sourceName}`);
      }

      if (fs.existsSync(targetRoot)) {
        const remainingTarget = ConnectionManager.readConnections(targetRoot);
        if (remainingTarget.connections.length === 0) {
          const removedTarget = AgentConfigInjector.remove(targetRoot);
          for (const file of removedTarget) {
            console.log(`  ${symbols.success} Removed Grome section from ${file} in ${targetName}`);
          }
        }
      }
    }

    console.log(`\n${symbols.success} ${color.green('Unlinked!')} ${sourceName} and ${targetName} are no longer connected.\n`);
  } catch (err) {
    console.error(`\n  ${symbols.error} ${color.red('Unlink failed:')} ${(err as Error).message}\n`);
    process.exit(1);
  }
}
