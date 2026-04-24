/**
 * Per-MCP-server-process session state. The MCP server is long-lived
 * per agent session, so binding once via `grome__register_session`
 * lets later `grome__chat_response` calls know which terminal pane
 * they belong to without re-asking.
 *
 * Falls back to the `GROME_TERMINAL_INSTANCE_ID` env var when set
 * (IDE injects this on spawn), so an agent that forgets to call
 * register_session still gets correct routing.
 */
export interface SessionBinding {
  terminalInstanceId: string | null;
  agent: string | null;
  registeredAt: string | null;
}

const state: SessionBinding = {
  terminalInstanceId: process.env.GROME_TERMINAL_INSTANCE_ID ?? null,
  agent: process.env.GROME_AGENT ?? null,
  registeredAt: null,
};

export function getSession(): SessionBinding {
  return state;
}

export function bindSession(terminalInstanceId: string, agent?: string): SessionBinding {
  state.terminalInstanceId = terminalInstanceId;
  if (agent) state.agent = agent;
  state.registeredAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return state;
}
