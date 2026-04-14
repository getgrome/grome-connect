import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { ConnectionManager } from '../core/ConnectionManager.js';
import { MemoryWriter } from '../core/MemoryWriter.js';
import { Scanner, FILE_COUNT_WARNING_THRESHOLD } from '../core/Scanner.js';
import { color, symbols } from '../utils.js';

const FREE_PLAN_LIMIT = 2;

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

export async function linkCommand(targetPath: string, options?: { force?: boolean }): Promise<void> {
  const sourceRoot = path.resolve(process.cwd());
  const targetRoot = path.resolve(targetPath);

  const sourceName = ConnectionManager.getProjectName(sourceRoot);
  const targetName = ConnectionManager.getProjectName(targetRoot);

  console.log(`\nLinking ${color.bold(sourceName)} ${symbols.arrow} ${color.bold(targetName)}...\n`);

  // Validate target exists
  if (!fs.existsSync(targetRoot)) {
    console.error(`  ${symbols.error} ${color.red('Path not found:')} ${targetRoot}`);
    console.error(`  Make sure the directory exists.\n`);
    process.exit(1);
  }

  if (sourceRoot === targetRoot) {
    console.error(`  ${symbols.error} ${color.red('Cannot link a project to itself.')}\n`);
    process.exit(1);
  }

  // Check free plan limit
  const existingConnections = ConnectionManager.readConnections(sourceRoot);
  const alreadyLinked = existingConnections.connections.some((c) => c.path === targetRoot);

  if (!alreadyLinked && existingConnections.connections.length >= FREE_PLAN_LIMIT) {
    console.error(`  ${symbols.error} ${color.red('Free plan limit reached:')} ${FREE_PLAN_LIMIT} connected projects.`);
    console.error(`  Upgrade to Grome Pro for unlimited connections.`);
    console.error(`  ${color.dim('https://getgrome.com/pricing')}\n`);
    process.exit(1);
  }

  // Pre-scan file count check — warn about large repos
  if (!options?.force) {
    const defaultConfig = {
      version: 1,
      projectId: '',
      deny: [],
      extractors: { routes: true, types: true, schemas: true, handoffs: true },
    };

    for (const [root, name] of [[sourceRoot, sourceName], [targetRoot, targetName]] as const) {
      let config = defaultConfig;
      try {
        if (ConnectionManager.isInitialized(root)) {
          config = ConnectionManager.readConfig(root);
        }
      } catch { /* use defaults */ }

      const scanner = new Scanner(root, config);
      console.log(`  Counting files in ${color.bold(name)}...`);
      const fileCount = await scanner.countFiles();
      console.log(`  ${color.dim(`${fileCount.toLocaleString()} files`)}`);

      if (fileCount > FILE_COUNT_WARNING_THRESHOLD) {
        console.log();
        console.log(`  ${symbols.warning} ${color.yellow(`${name} has ${fileCount.toLocaleString()} scannable files.`)}`);
        console.log(`  ${color.dim('Large repos slow down scanning and produce bloated memory files.')}`);
        console.log(`  ${color.dim('Consider adding an allow list in .grome/config.json:')}`);
        console.log(`  ${color.dim('  "allow": ["src/**", "lib/**", "prisma/**"]')}`);
        console.log();

        const proceed = await confirm(`  Continue anyway? [y/N] `);
        if (!proceed) {
          console.log(`\n  ${color.dim('Aborted. Add deny/allow patterns to .grome/config.json, then retry.')}\n`);
          process.exit(0);
        }
      }
    }
    console.log();
  }

  try {
    // Link (auto-inits both)
    await ConnectionManager.link(sourceRoot, targetRoot);

    console.log(`  ${symbols.success} Initialized ${color.bold(sourceName)}`);
    console.log(`  ${symbols.success} Initialized ${color.bold(targetName)}`);
    console.log(`  ${symbols.success} Connection established\n`);

    // Auto-sync
    console.log(`Syncing...\n`);
    const result = await MemoryWriter.sync(
      sourceRoot,
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
      }
    );

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
    console.error(`\n  ${symbols.error} ${color.red('Link failed:')} ${(err as Error).message}\n`);
    process.exit(1);
  }
}
