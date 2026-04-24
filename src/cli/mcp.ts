import * as path from 'node:path';
import { runMcpServer } from '../mcp/server.js';

export async function mcpCommand(): Promise<void> {
  const workspaceRoot = path.resolve(process.cwd());
  await runMcpServer(workspaceRoot);
}
