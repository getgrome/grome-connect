import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

// Stamp the package version in at build time so the bundle doesn't need
// to readFileSync('../package.json') at runtime — otherwise consumers
// who drop just dist/*.cjs into a directory (no sibling package.json)
// hit ENOENT on load.
const define = { __CLI_VERSION__: JSON.stringify(pkg.version) };

// Two builds:
//
// 1. CJS — fully self-contained. `noExternal` inlines runtime deps so the
//    Grome IDE (which embeds `dist/index.cjs` with no node_modules) just
//    works. Pure JS deps only; native-addon deps would need to stay external.
//
// 2. ESM — deps stay external. The ESM build is consumed via `bin/cli.js`
//    with a normal npm install, so node resolves deps from node_modules.
//    Inlining CJS-authored deps (commander) into an ESM output crashes at
//    load time because commander's internal `require()` can't run there.
export default defineConfig([
  {
    entry: ['src/index.ts', 'src/cli.ts'],
    format: 'cjs',
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node18',
    splitting: false,
    noExternal: ['commander', 'fast-glob', 'micromatch'],
    define,
  },
  {
    entry: ['src/index.ts', 'src/cli.ts'],
    format: 'esm',
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'node18',
    splitting: false,
    define,
  },
]);
