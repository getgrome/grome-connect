import fg from 'fast-glob';
import { PermissionChecker } from './PermissionChecker.js';
import type { GromeConfig } from '../types.js';

/** Default threshold — warn if more files than this */
export const FILE_COUNT_WARNING_THRESHOLD = 5000;

export class Scanner {
  private projectRoot: string;
  private checker: PermissionChecker;

  constructor(projectRoot: string, config: GromeConfig) {
    this.projectRoot = projectRoot;
    this.checker = new PermissionChecker(config);
  }

  /**
   * Quick count of scannable files (respects deny patterns).
   * Use before full scan to warn about large repos.
   */
  async countFiles(): Promise<number> {
    const allFiles = await fg('**/*', {
      cwd: this.projectRoot,
      dot: true,
      ignore: this.checker.getDenyPatterns(),
      onlyFiles: true,
      followSymbolicLinks: false,
      stats: false,
    });
    return this.checker.filter(allFiles).length;
  }

  /**
   * Scan the project and return all allowed relative file paths.
   */
  async scan(): Promise<string[]> {
    const allFiles = await fg('**/*', {
      cwd: this.projectRoot,
      dot: true,
      ignore: this.checker.getDenyPatterns(),
      onlyFiles: true,
      followSymbolicLinks: false,
    });

    return this.checker.filter(allFiles);
  }

  /**
   * Scan for specific glob patterns (e.g., finding route files).
   */
  async scanPattern(pattern: string | string[]): Promise<string[]> {
    const files = await fg(pattern, {
      cwd: this.projectRoot,
      dot: true,
      ignore: this.checker.getDenyPatterns(),
      onlyFiles: true,
      followSymbolicLinks: false,
    });

    return this.checker.filter(files);
  }
}
