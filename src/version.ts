import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve __dirname in both CJS (native) and ESM (via import.meta.url).
// tsup's CJS shim stubs import.meta to `{}`, so relying on import.meta.url
// alone breaks `require('grome-connect')` at load time.
declare const __dirname: string | undefined;
const here =
  typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, '..', 'package.json'), 'utf8'),
) as { version: string };

/**
 * The running CLI version, read from package.json at runtime. Stamped into
 * every file grome-connect writes so consumers (and future versions of
 * grome-connect itself) can detect which version produced a given artifact.
 */
export const CLI_VERSION: string = pkg.version;

/**
 * Compare two semver-ish strings. Returns positive if a > b, negative if
 * a < b, zero if equal. Only handles numeric X.Y.Z; ignores pre-release
 * suffixes (safe fallback: treated as equal to the base).
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v.split('.').slice(0, 3).map((p) => parseInt(p, 10) || 0);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}
