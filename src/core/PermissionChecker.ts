import micromatch from 'micromatch';
import type { GromeConfig } from '../types.js';

/**
 * Patterns that are ALWAYS denied — cannot be overridden by user config.
 * Each dir pattern uses `**\/dir/**` form to match at any depth, so nested
 * copies (e.g. `test/*\/node_modules/`) are caught as well as top-level.
 */
const UNCONDITIONAL_DENY = [
  // Secrets
  '**/.env',
  '**/.env.*',
  '**/*.secret',
  '**/credentials.*',
  '**/*.pem',
  '**/*.key',
  // Dependencies
  '**/node_modules/**',
  // VCS / tooling
  '**/.git/**',
  '**/.hg/**',
  '**/.svn/**',
  // Build artifacts
  '**/dist/**',
  '**/build/**',
  '**/.build/**',
  '**/out/**',
  '**/target/**',
  '**/.next/**',
  '**/.vercel/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/.parcel-cache/**',
  '**/.svelte-kit/**',
  '**/.nuxt/**',
  '**/.output/**',
  '**/coverage/**',
  '**/__pycache__/**',
  // Minified / sourcemaps
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  // VS Code / Electron specific
  '**/.vscode-test/**',
  // Grome internals
  '**/.grome/attachments/**',
];

export class PermissionChecker {
  private denyPatterns: string[];
  private allowPatterns: string[] | null;

  constructor(config: GromeConfig) {
    const userDeny = config.deny || [];
    const patterns = [...UNCONDITIONAL_DENY, ...userDeny];
    // `.d.ts` files are almost always vendored or auto-generated API dumps.
    // Skip by default; allow opt-in via extractors.declarationFiles.
    if (!config.extractors?.declarationFiles) {
      patterns.push('**/*.d.ts');
    }
    this.denyPatterns = patterns;
    this.allowPatterns = config.allow && config.allow.length > 0 ? config.allow : null;
  }

  /**
   * Check if a relative file path is allowed for scanning.
   */
  isAllowed(relativePath: string): boolean {
    // Deny always takes priority
    if (micromatch.isMatch(relativePath, this.denyPatterns)) {
      return false;
    }

    // If allow list exists, file must match it
    if (this.allowPatterns) {
      return micromatch.isMatch(relativePath, this.allowPatterns);
    }

    return true;
  }

  /**
   * Filter a list of relative paths, returning only allowed ones.
   */
  filter(relativePaths: string[]): string[] {
    return relativePaths.filter((p) => this.isAllowed(p));
  }

  getDenyPatterns(): string[] {
    return [...this.denyPatterns];
  }
}
