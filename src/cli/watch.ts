import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConnectionManager } from '../core/ConnectionManager.js';
import { MemoryWriter } from '../core/MemoryWriter.js';
import { color, symbols } from '../utils.js';

const DEBOUNCE_MS = 3000;
const WATCH_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.prisma', '.json']);

export async function watchCommand(): Promise<void> {
  const projectRoot = path.resolve(process.cwd());

  if (!ConnectionManager.isInitialized(projectRoot)) {
    console.error(`\n  ${symbols.error} ${color.red('Not initialized.')} Run ${color.cyan('grome init')} first.\n`);
    process.exit(1);
  }

  const connections = ConnectionManager.readConnections(projectRoot);
  if (connections.connections.length === 0) {
    console.log(`\n  ${color.dim('No connections found.')} Run ${color.cyan('grome link <path>')} to connect a project.\n`);
    return;
  }

  const allRoots = ConnectionManager.getAllProjectRoots(projectRoot);
  console.log(`\n${symbols.success} Watching ${allRoots.length} connected projects for changes...\n`);
  for (const root of allRoots) {
    console.log(`  ${color.dim(root)}`);
  }
  console.log(`\n  ${color.dim(`Auto-sync triggers ${DEBOUNCE_MS / 1000}s after file changes.`)}`);
  console.log(`  ${color.dim('Press Ctrl+C to stop.')}\n`);

  // Initial sync
  await doSync(projectRoot);

  // Watch all project roots
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let syncing = false;

  const triggerSync = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (syncing) return;
      syncing = true;
      await doSync(projectRoot);
      syncing = false;
    }, DEBOUNCE_MS);
  };

  for (const root of allRoots) {
    try {
      const srcDir = path.join(root, 'src');
      const watchDir = fs.existsSync(srcDir) ? srcDir : root;

      fs.watch(watchDir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const ext = path.extname(filename);
        if (!WATCH_EXTENSIONS.has(ext)) return;
        // Skip .grome/ changes to avoid infinite loops
        if (filename.includes('.grome')) return;
        console.log(`  ${color.dim(`Changed: ${path.basename(root)}/${filename}`)}`);
        triggerSync();
      });
    } catch {
      console.log(`  ${symbols.warning} Could not watch ${root}`);
    }
  }

  // Keep process alive
  process.on('SIGINT', () => {
    console.log(`\n${color.dim('Stopped watching.')}\n`);
    process.exit(0);
  });
}

async function doSync(projectRoot: string): Promise<void> {
  try {
    const start = Date.now();
    const result = await MemoryWriter.sync(projectRoot);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(
      `  ${symbols.success} ${color.green('Synced')} ${result.totalRoutes} routes, ${result.totalTypes} types, ${result.totalSchemas} schemas ${color.dim(`(${elapsed}s)`)}`
    );
    if (result.autoHandoffs?.length) {
      for (const h of result.autoHandoffs) {
        const icon = h.type === 'breaking-change' ? symbols.warning : symbols.arrow;
        console.log(`  ${icon} Handoff: ${h.summary}`);
      }
    }
  } catch (err) {
    console.error(`  ${symbols.error} ${color.red('Sync failed:')} ${(err as Error).message}`);
  }
}
