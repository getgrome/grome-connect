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
  '**/*.p12',
  '**/*.pfx',

  // JS / TS dependencies + tooling
  '**/node_modules/**',
  '**/.yarn/**',
  '**/.pnp.*',
  '**/.pnpm-store/**',
  '**/pnpm-store/**',
  '**/bower_components/**',
  '**/jspm_packages/**',

  // Go / PHP / Composer vendored deps
  '**/vendor/**',

  // Python
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/.tox/**',
  '**/.nox/**',
  '**/.pytest_cache/**',
  '**/.mypy_cache/**',
  '**/.ruff_cache/**',
  '**/.pytype/**',
  '**/site-packages/**',
  '**/*.egg-info/**',
  '**/*.egg/**',
  '**/eggs/**',
  '**/htmlcov/**',
  '**/.ipynb_checkpoints/**',
  '**/*.pyc',
  '**/*.pyo',
  '**/*.pyd',

  // Ruby
  '**/.bundle/**',
  '**/*.gem',

  // JVM (Java / Kotlin / Scala)
  '**/.gradle/**',
  '**/.m2/**',
  '**/*.class',
  '**/*.jar',
  '**/*.war',
  '**/*.ear',

  // Rust
  '**/*.rlib',

  // .NET (compiled output only — bin/ and obj/ conflict with legitimate
  // usages in Node projects, so we rely on file extensions instead)
  '**/*.dll',
  '**/*.pdb',

  // Native / compiled
  '**/*.o',
  '**/*.a',
  '**/*.so',
  '**/*.dylib',
  '**/*.exe',
  '**/*.wasm',

  // iOS / macOS / Android
  '**/Pods/**',
  '**/DerivedData/**',
  '**/*.xcworkspace/**',
  '**/*.xcodeproj/**',
  '**/*.framework/**',

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

  // IaC / serverless / deploy
  '**/.terraform/**',
  '**/.serverless/**',
  '**/cdk.out/**',

  // Minified / sourcemaps
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',

  // Archives / large binaries
  '**/*.zip',
  '**/*.tar',
  '**/*.tar.gz',
  '**/*.tgz',
  '**/*.gz',
  '**/*.rar',
  '**/*.7z',

  // Editors / IDE caches
  '**/.vscode-test/**',
  '**/.history/**',
  '**/.fleet/**',

  // OS cruft
  '**/.DS_Store',
  '**/Thumbs.db',

  // Logs / temp
  '**/*.log',
  '**/tmp/**',
  '**/temp/**',
  '**/logs/**',

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
