import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConnectionManager } from '../core/ConnectionManager.js';
import { MemoryWriter } from '../core/MemoryWriter.js';
import { color, symbols } from '../utils.js';

export interface SyncCommandOptions {
  force?: boolean;
  noMcp?: boolean;
  noSkill?: boolean;
}

export async function syncCommand(options: SyncCommandOptions = {}): Promise<void> {
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

  const brokenConnections = connections.connections.filter((c) => !fs.existsSync(c.path));
  for (const broken of brokenConnections) {
    console.log(`  ${symbols.warning} ${color.yellow(`Connection to ${broken.name} is broken:`)} ${broken.path}`);
    console.log(`    Run ${color.cyan(`grome link <new-path>`)} to update.\n`);
  }

  try {
    console.log();
    const result = await MemoryWriter.sync(projectRoot, {
      noMcp: options.noMcp,
      noSkill: options.noSkill,
    });

    for (const project of result.projects) {
      const langs = project.languages.length > 0 ? ` [${project.languages.join(', ')}]` : '';
      const fw = project.framework ? ` (${project.framework})` : '';
      console.log(`  ${symbols.success} ${color.bold(project.name)}${fw}${langs}`);
    }

    for (const [name, files] of result.updatedConfigs) {
      for (const file of files) {
        console.log(`    Updated ${file} in ${name}`);
      }
    }

    for (const [name, files] of result.legacyCleanup) {
      console.log(`  ${color.dim(`Cleaned up legacy files in ${name}:`)} ${files.join(', ')}`);
    }

    for (const [name, entries] of result.provisioning) {
      const interesting = entries.filter((e) => e.action !== 'unchanged');
      if (interesting.length === 0) continue;
      for (const e of interesting) {
        const rel = e.path.startsWith(projectRoot)
          ? e.path.slice(projectRoot.length + 1)
          : e.path;
        const verb =
          e.action === 'created' ? color.green('created') :
          e.action === 'updated' ? color.cyan('updated') :
          e.action === 'skipped-user-managed' ? color.dim('skipped (user-managed)') :
          e.action === 'skipped-opt-out' ? color.dim('skipped (opt-out)') :
          e.action;
        console.log(`    ${verb} ${rel} ${color.dim(`(${e.kind}, ${name})`)}`);
      }
    }

    console.log(`\n${symbols.success} ${color.green('Synced.')} Threads propagated; agent files + grome.md refreshed; .mcp.json + skill provisioned.\n`);
  } catch (err) {
    console.error(`\n  ${symbols.error} ${color.red('Sync failed:')} ${(err as Error).message}\n`);
    process.exit(1);
  }
}
