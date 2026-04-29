import { Command } from 'commander';
import { CLI_VERSION } from './version.js';
import { initCommand } from './cli/init.js';
import { linkCommand } from './cli/link.js';
import { syncCommand } from './cli/sync.js';
import { statusCommand } from './cli/status.js';
import { unlinkCommand } from './cli/unlink.js';
import { watchCommand } from './cli/watch.js';
import { mcpCommand } from './cli/mcp.js';

const program = new Command();

program
  .name('grome')
  .description('CLI for connected workspaces — link projects, share context with AI agents')
  .version(CLI_VERSION);

program
  .command('init')
  .description('Initialize .grome/ in the current project')
  .option('--register-mcp', 'Also register the grome MCP server in .mcp.json at repo root')
  .action((opts: { registerMcp?: boolean }) => initCommand(opts));

program
  .command('link <path>')
  .alias('connect')
  .description('Connect another project directory (bidirectional)')
  .option('--force', 'Skip large repo warning')
  .option('--agents <list>', 'Comma-separated: detect | all | none | <alias,alias> (e.g. claude,cursor)')
  .option('-y, --yes', 'Accept defaults non-interactively')
  .option('--register-mcp', 'Also register the grome MCP server in .mcp.json at both repo roots')
  .action(
    (
      targetPath: string,
      opts: { force?: boolean; agents?: string; yes?: boolean; registerMcp?: boolean }
    ) => linkCommand(targetPath, opts)
  );

program
  .command('sync')
  .description('Propagate threads and (if source changed) re-extract shared memory')
  .action(syncCommand);

program
  .command('sync-full')
  .description('Force a full rescan — ignore sync index, rebuild all memory')
  .action(() => syncCommand({ force: true }));

program
  .command('status')
  .description('Show connections, memory stats, and sync freshness')
  .action(statusCommand);

program
  .command('unlink <path>')
  .alias('disconnect')
  .description('Remove a project connection')
  .option('--unregister-mcp', 'Also remove the grome MCP server from .mcp.json in both repos (sentinel-guarded)')
  .action((targetPath: string, opts: { unregisterMcp?: boolean }) =>
    unlinkCommand(targetPath, opts)
  );

program
  .command('watch')
  .description('Watch .grome/threads/ + .grome/sessions/ and emit events when peer agents post')
  .option('--poll', 'Use polling instead of fs.watch (network / external drives)')
  .option('--force', 'Take over watcher even if another pid is live')
  .action((opts: { poll?: boolean; force?: boolean }) => watchCommand(opts));

program
  .command('mcp')
  .description('Run the Grome MCP server (stdio JSON-RPC) — exposes grome__ tools to MCP-compatible agents')
  .action(mcpCommand);

program.parse();
