import * as path from 'node:path';
import { ConnectionManager } from '../core/ConnectionManager.js';
import { McpRegistrar } from '../core/McpRegistrar.js';
import { color, symbols } from '../utils.js';

export interface InitOptions {
  registerMcp?: boolean;
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const projectRoot = path.resolve(process.cwd());
  const projectName = ConnectionManager.getProjectName(projectRoot);

  console.log(`\nInitializing Grome in ${color.bold(projectName)}...\n`);

  try {
    const wasAlreadyInit = ConnectionManager.isInitialized(projectRoot);
    const config = await ConnectionManager.init(projectRoot);

    if (wasAlreadyInit) {
      console.log(`  ${symbols.success} .grome/ already exists (project ID: ${color.cyan(config.projectId)})`);
      console.log(`  ${symbols.success} Config preserved\n`);
    } else {
      console.log(`  ${symbols.success} Created .grome/config.json (project ID: ${color.cyan(config.projectId)})`);
      console.log(`  ${symbols.success} Created .grome/connections.json`);
      console.log(`  ${symbols.success} Created .grome/memory/`);
      console.log(`  ${symbols.success} Updated .gitignore\n`);
    }

    if (options.registerMcp) {
      const res = await McpRegistrar.register(projectRoot);
      const label = `.mcp.json (${res.action})`;
      console.log(`  ${symbols.success} Registered grome MCP server: ${label}\n`);
    }

    console.log(`${symbols.success} ${color.green('Initialized!')} Run ${color.cyan('grome link <path>')} to connect another project.\n`);
  } catch (err) {
    console.error(`\n  ${symbols.error} ${color.red('Failed to initialize:')} ${(err as Error).message}\n`);
    process.exit(1);
  }
}
