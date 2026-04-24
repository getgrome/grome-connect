export interface ToolContext {
  workspaceRoot: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}
