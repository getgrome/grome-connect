import { CLI_VERSION } from '../version.js';
import { readThreadTool } from './tools/read_thread.js';
import { listThreadsTool } from './tools/list_threads.js';
import { listSessionsTool } from './tools/list_sessions.js';
import { readSessionTool } from './tools/read_session.js';
import { listUnreadInboxTool } from './tools/list_unread_inbox.js';
import { replyThreadTool } from './tools/reply_thread.js';
import { newThreadTool } from './tools/new_thread.js';
import { resolveThreadTool } from './tools/resolve_thread.js';
import { markInboxReadTool } from './tools/mark_inbox_read.js';
import { syncTool } from './tools/sync.js';
import { registerSessionTool } from './tools/register_session.js';
import { chatResponseTool } from './tools/chat_response.js';
import type { Tool, ToolContext } from './types.js';

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const TOOLS: Tool[] = [
  // read-side
  readThreadTool,
  listThreadsTool,
  listSessionsTool,
  readSessionTool,
  listUnreadInboxTool,
  // write-side
  replyThreadTool,
  newThreadTool,
  resolveThreadTool,
  markInboxReadTool,
  syncTool,
  registerSessionTool,
  chatResponseTool,
];

function writeMessage(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function log(...args: unknown[]): void {
  // MCP over stdio reserves stdout for JSON-RPC. All logs go to stderr.
  process.stderr.write('[grome-mcp] ' + args.map(String).join(' ') + '\n');
}

async function dispatch(req: JsonRpcRequest, ctx: ToolContext): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;

  switch (req.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'grome-connect', version: CLI_VERSION },
        },
      };

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null; // notification — no response

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      };

    case 'tools/call': {
      const params = req.params ?? {};
      const name = params.name as string;
      const args = (params.arguments as Record<string, unknown>) ?? {};
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unknown tool: ${name}` },
        };
      }
      try {
        const result = await tool.handler(args, ctx);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: message }],
            isError: true,
          },
        };
      }
    }

    default:
      if (req.method.startsWith('notifications/')) return null;
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      };
  }
}

export async function runMcpServer(workspaceRoot: string): Promise<void> {
  const ctx: ToolContext = { workspaceRoot };
  log(`started (workspace=${workspaceRoot}, version=${CLI_VERSION})`);

  let buffer = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;

      let req: JsonRpcRequest;
      try {
        req = JSON.parse(line);
      } catch {
        writeMessage({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        });
        continue;
      }

      dispatch(req, ctx)
        .then((resp) => {
          if (resp) writeMessage(resp);
        })
        .catch((err) => {
          log('dispatch error:', err);
          writeMessage({
            jsonrpc: '2.0',
            id: req.id ?? null,
            error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
          });
        });
    }
  });

  process.stdin.on('end', () => {
    log('stdin closed, exiting');
    process.exit(0);
  });

  await new Promise(() => {}); // run until stdin closes
}
