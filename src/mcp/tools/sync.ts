import { MemoryWriter } from '../../core/MemoryWriter.js';
import type { Tool } from '../types.js';

export const syncTool: Tool = {
  name: 'grome__sync',
  description:
    'Explicitly run `grome sync` — propagates threads + regenerates _index.md across all connected workspaces. ' +
    'Write-side thread tools call this internally, so you only need it to force a resync after out-of-band edits.',
  inputSchema: { type: 'object', properties: {} },
  handler: async (_args, ctx) => {
    const result = await MemoryWriter.sync(ctx.workspaceRoot);
    return {
      synced: true,
      projects: result.projects.map((p) => ({ name: p.name, framework: p.framework })),
    };
  },
};
