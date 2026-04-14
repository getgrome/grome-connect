import { Command } from 'commander';
import { initCommand } from './cli/init.js';
import { linkCommand } from './cli/link.js';
import { syncCommand } from './cli/sync.js';
import { statusCommand } from './cli/status.js';
import { unlinkCommand } from './cli/unlink.js';
import { watchCommand } from './cli/watch.js';
import { handoffCommand, handoffListCommand, handoffAckCommand, handoffDoneCommand } from './cli/handoff.js';

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
  .description('Scan all connected projects and write shared memory files')
  .action(syncCommand);

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

program
  .command('handoff <summary>')
  .description('Create a handoff note for connected projects')
  .option('--type <type>', 'Type: feature-complete, breaking-change, dependency-update, migration, note', 'note')
  .option('--files <files>', 'Comma-separated list of changed files')
  .option('--breaking <changes>', 'Comma-separated breaking changes')
  .option('--deps <deps>', 'Comma-separated new dependencies')
  .option('--env <vars>', 'Comma-separated new env vars')
  .option('--notes <text>', 'Additional notes for agents')
  .action((summary: string, opts) => handoffCommand(summary, opts));

program
  .command('handoffs')
  .description('List all handoffs')
  .action(handoffListCommand);

program
  .command('handoff-ack <id>')
  .description('Acknowledge a handoff')
  .action(handoffAckCommand);

program
  .command('handoff-done <id>')
  .description('Mark a handoff as completed')
  .action(handoffDoneCommand);

program.parse();
