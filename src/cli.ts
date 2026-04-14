import { Command } from 'commander';
import { initCommand } from './cli/init.js';
import { linkCommand } from './cli/link.js';
import { syncCommand } from './cli/sync.js';
import { statusCommand } from './cli/status.js';
import { unlinkCommand } from './cli/unlink.js';
import { watchCommand } from './cli/watch.js';

const program = new Command();

program
  .name('grome')
  .description('CLI for connected workspaces — link projects, share context with AI agents')
  .version('0.1.1');

program
  .command('init')
  .description('Initialize .grome/ in the current project')
  .action(initCommand);

program
  .command('link <path>')
  .description('Connect another project directory (bidirectional)')
  .option('--force', 'Skip large repo warning')
  .action((targetPath: string, opts: { force?: boolean }) => linkCommand(targetPath, opts));

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
  .description('Remove a project connection')
  .action(unlinkCommand);

program
  .command('watch')
  .description('Watch connected projects and auto-sync on file changes')
  .action(watchCommand);

program.parse();
