// Public library API for embedding grome-connect inside other tools (e.g. the Grome IDE).
// The CLI entrypoint lives in ./cli.ts.

export { ConnectionManager } from './core/ConnectionManager.js';
export { MemoryWriter } from './core/MemoryWriter.js';
export { AgentConfigInjector, buildInjection } from './core/AgentConfigInjector.js';
export { Scanner } from './core/Scanner.js';
export { detectFramework } from './extractors/detection.js';

export type * from './types.js';
