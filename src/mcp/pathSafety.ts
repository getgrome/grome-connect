import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Resolve a user-supplied thread or session path under a required
 * subdirectory of the workspace. Enforces the locked write-side policy:
 *
 * 1. Reject `..` segments up front (don't wait for realpath after a
 *    traversal might have already hit the FS).
 * 2. Reject absolute paths unless they already resolve inside the
 *    required subdirectory.
 * 3. Confine the result to the named subdirectory of `.grome/`.
 * 4. Normalise against the workspace root (and realpath if the file
 *    exists) so symlink-chases can't escape.
 *
 * Returns the absolute, normalised path. Throws on any violation.
 */
export function resolveWriteTarget(
  workspaceRoot: string,
  requiredSubdir: 'threads' | 'sessions',
  inputPath: string,
): string {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    throw new Error('path must be a non-empty string');
  }
  if (inputPath.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error('path must not contain ".." segments');
  }

  const baseDir = path.resolve(workspaceRoot, '.grome', requiredSubdir);

  let candidate: string;
  if (path.isAbsolute(inputPath)) {
    candidate = path.normalize(inputPath);
  } else if (inputPath.includes('/')) {
    // Workspace-relative (e.g. ".grome/threads/foo.md").
    candidate = path.resolve(workspaceRoot, inputPath);
  } else {
    // Bare filename → slot into the required subdir.
    candidate = path.resolve(baseDir, inputPath);
  }

  const normalized = path.normalize(candidate);
  if (!normalized.startsWith(baseDir + path.sep) && normalized !== baseDir) {
    throw new Error(`path must resolve inside .grome/${requiredSubdir}/`);
  }

  // If the file exists, realpath-check to defeat symlink escapes.
  if (fs.existsSync(normalized)) {
    const real = fs.realpathSync(normalized);
    const realBase = fs.realpathSync(baseDir);
    if (!real.startsWith(realBase + path.sep) && real !== realBase) {
      throw new Error(`path resolves outside .grome/${requiredSubdir}/ via symlink`);
    }
    return real;
  }

  // For new files, realpath the parent dir to catch symlinked
  // subdirectories escaping the workspace.
  const parent = path.dirname(normalized);
  if (fs.existsSync(parent)) {
    const realParent = fs.realpathSync(parent);
    const realBase = fs.realpathSync(baseDir);
    if (!realParent.startsWith(realBase + path.sep) && realParent !== realBase) {
      throw new Error(`parent dir resolves outside .grome/${requiredSubdir}/ via symlink`);
    }
  }

  return normalized;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

/**
 * `YYYY-MM-DD-HHmm` in UTC. Matches the filename convention in grome.md.
 */
export function threadTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
  );
}
