// Inlined at build time by tsup via esbuild `define`. No runtime
// package.json read, so the bundle is self-contained and works even
// when dropped into a directory with no sibling package.json.
declare const __CLI_VERSION__: string;

/**
 * The running CLI version, stamped in at build time. Written into every
 * file grome-connect produces so consumers (and future versions of the
 * CLI itself) can detect which version produced a given artifact.
 */
export const CLI_VERSION: string = __CLI_VERSION__;

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
