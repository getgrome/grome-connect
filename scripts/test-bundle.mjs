#!/usr/bin/env node
// Smoke-test that dist/index.cjs and dist/cli.cjs load from a bare
// temp directory — no sibling package.json, no node_modules. Guards
// against regressions where a new runtime dep or runtime fs read
// breaks the standalone-bundle story that the Grome IDE relies on.

import { mkdtempSync, cpSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'grome-connect-bundle-'));
cpSync('dist/index.cjs', join(dir, 'index.cjs'));
cpSync('dist/cli.cjs', join(dir, 'cli.cjs'));

// Also smoke-test the ESM bundle through a real npm install. The CJS
// bundle is self-contained by design (tsup `noExternal`), but the ESM
// bundle relies on external deps being resolvable — this catches any
// regression in the ESM format (e.g. accidentally inlining a CJS-only
// dep like commander, which breaks ESM with "Dynamic require not supported").

console.log(`bundle test dir: ${dir}`);
console.log(`contents: ${readdirSync(dir).join(', ')}`);

const node = process.execPath;
const loadTest = `const m = require('./index.cjs'); if (!m.AgentConfigInjector || !m.MemoryWriter) { console.error('missing exports'); process.exit(1); } console.log('index.cjs OK — exports:', Object.keys(m).length);`;

try {
  execFileSync(node, ['-e', loadTest], { cwd: dir, stdio: 'inherit' });
  const cjsVersion = execFileSync(node, ['./cli.cjs', '--version'], { cwd: dir }).toString().trim();
  console.log(`cli.cjs --version: ${cjsVersion}`);

  // ESM bundle test: run from the repo root so node_modules resolves normally.
  // This catches the case where bundling a CJS-only dep into ESM output
  // produces "Dynamic require of X is not supported" at load time.
  const esmVersion = execFileSync(node, ['./dist/cli.js', '--version']).toString().trim();
  console.log(`cli.js (ESM) --version: ${esmVersion}`);

  console.log('\n✓ bundle loads standalone (CJS) and via node_modules (ESM)');
} catch (err) {
  console.error('\n✗ bundle smoke test FAILED');
  process.exit(1);
}
