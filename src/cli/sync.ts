import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConnectionManager } from '../core/ConnectionManager.js';
import { MemoryWriter } from '../core/MemoryWriter.js';
import { color, symbols } from '../utils.js';

export async function syncCommand(options?: { force?: boolean }): Promise<void> {
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

  // Check for broken connections
  const brokenConnections = connections.connections.filter((c) => {
    return !fs.existsSync(c.path);
  });

  for (const broken of brokenConnections) {
    console.log(`  ${symbols.warning} ${color.yellow(`Connection to ${broken.name} is broken:`)} ${broken.path}`);
    console.log(`    Run ${color.cyan(`grome link <new-path>`)} to update.\n`);
  }

  try {
    console.log();
    const result = await MemoryWriter.sync(
      projectRoot,
      (name) => console.log(`Scanning ${color.bold(name)}...`),
      (name, extraction, framework) => {
        const frameworkLabel = framework ? ` (${framework})` : '';
        if (extraction.routes.length > 0)
          console.log(`  ${symbols.success} ${extraction.routes.length} routes${frameworkLabel}`);
        if (extraction.types.length > 0)
          console.log(`  ${symbols.success} ${extraction.types.length} types (TypeScript)`);
        if (extraction.schemas.length > 0)
          console.log(`  ${symbols.success} ${extraction.schemas.length} schemas`);
        if (extraction.routes.length === 0 && extraction.types.length === 0 && extraction.schemas.length === 0)
          console.log(`  ${color.dim('  No extractable items found')}`);
      },
      options
    );

    if (result.extractionSkipped) {
      console.log(`  ${color.dim('Source unchanged — extraction skipped.')} ${color.dim(`(use ${color.cyan('grome sync-full')} to force.)`)}`);
      console.log(`\n${symbols.success} ${color.green('Threads propagated.')}\n`);
      return;
    }

    console.log(`\nWriting memory to ${result.projects.length} projects...`);
    for (const project of result.projects) {
      console.log(`  ${symbols.success} ${project.name}/.grome/memory/ (5 files)`);
    }

    for (const [name, files] of result.updatedConfigs) {
      for (const file of files) {
        console.log(`Updated ${file} in ${name}`);
      }
    }

    console.log(
      `\n${symbols.success} ${color.green('Synced')} ${result.totalRoutes} routes, ${result.totalTypes} types, ${result.totalSchemas} schemas\n`
    );
  } catch (err) {
    console.error(`\n  ${symbols.error} ${color.red('Sync failed:')} ${(err as Error).message}\n`);
    process.exit(1);
  }
}
