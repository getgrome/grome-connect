import micromatch from 'micromatch';
import type { GromeConfig } from '../types.js';

const HARDCODED_DENY = [
  '.env*',
  'node_modules/**',
  '.git/**',
  '.grome/attachments/**',
  '*.secret',
  'credentials.*',
  '*.pem',
  '*.key',
  // Build artifacts
  'dist/**',
  '.build/**',
  'build/**',
  'out/**',
  '.next/**',
  '.turbo/**',
  '.cache/**',
  'coverage/**',
  // Minified / sourcemaps
  '*.min.js',
  '*.min.css',
  '*.map',
  // VS Code / Electron specific
  '.vscode-test/**',
  'extensions/**/node_modules/**',
];

export class PermissionChecker {
  private denyPatterns: string[];
  private allowPatterns: string[] | null;

  constructor(config: GromeConfig) {
    this.denyPatterns = [...HARDCODED_DENY, ...(config.deny || [])];
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
