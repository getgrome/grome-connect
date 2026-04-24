import { bindSession } from '../session.js';
import type { Tool } from '../types.js';

export const registerSessionTool: Tool = {
  name: 'grome__register_session',
  description:
    'Bind this MCP server process to a specific terminal pane. Call once at session start (or lazily ' +
    'before the first `grome__chat_response`). Agent-agnostic — works for Claude, Codex, Gemini. ' +
    'The IDE also injects `GROME_TERMINAL_INSTANCE_ID` into the agent env; calling this tool overrides that.',
  inputSchema: {
    type: 'object',
    properties: {
      terminalInstanceId: {
        type: 'string',
        description: 'Opaque terminal-instance identifier supplied by the Grome IDE.',
      },
      agent: {
        type: 'string',
        description: 'Optional agent name (e.g. "claude", "codex", "gemini") used for display routing.',
      },
    },
    required: ['terminalInstanceId'],
  },
  handler: async (args) => {
    const { terminalInstanceId, agent } = args as { terminalInstanceId: string; agent?: string };
    if (!terminalInstanceId?.trim()) throw new Error('terminalInstanceId must be a non-empty string');
    const binding = bindSession(terminalInstanceId.trim(), agent?.trim());
    return {
      terminalInstanceId: binding.terminalInstanceId,
      agent: binding.agent,
      registeredAt: binding.registeredAt,
    };
  },
};
