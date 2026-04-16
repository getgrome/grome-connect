import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node18',
  splitting: false,
  // Inline all runtime deps so the bundled dist/index.cjs and dist/cli.cjs
  // are self-contained. This matters for consumers that embed dist/ without
  // a node_modules alongside (e.g. the Grome IDE's packaged app). Every
  // current runtime dep is pure JS; if a native-addon dep is ever added,
  // it must be moved to `external` instead.
  noExternal: ['commander', 'fast-glob', 'micromatch'],
  // Stamp the package version in at build time so the bundle doesn't need
  // to readFileSync('../package.json') at runtime — otherwise consumers
  // who drop just dist/*.cjs into a directory (no sibling package.json)
  // hit ENOENT on load.
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
});
