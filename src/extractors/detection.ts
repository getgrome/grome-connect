import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Framework } from '../types.js';

const FRAMEWORK_MAP: Record<string, Framework> = {
  express: 'express',
  next: 'next',
  fastify: 'fastify',
  hono: 'hono',
  koa: 'koa',
};

/**
 * Detect framework from package.json dependencies.
 */
export function detectFramework(projectRoot: string): Framework {
  const pkgPath = path.join(projectRoot, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    return null;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    for (const [depName, framework] of Object.entries(FRAMEWORK_MAP)) {
      if (allDeps[depName]) {
        return framework;
      }
    }
  } catch {
    // Invalid JSON or read error
  }

  return null;
}

const LANGUAGE_MARKERS: Array<{ file: string; language: string }> = [
  { file: 'package.json', language: 'typescript' },
  { file: 'tsconfig.json', language: 'typescript' },
  { file: 'go.mod', language: 'go' },
  { file: 'Cargo.toml', language: 'rust' },
  { file: 'pyproject.toml', language: 'python' },
  { file: 'requirements.txt', language: 'python' },
  { file: 'Gemfile', language: 'ruby' },
  { file: 'composer.json', language: 'php' },
  { file: 'pom.xml', language: 'java' },
  { file: 'build.gradle', language: 'java' },
  { file: 'build.gradle.kts', language: 'kotlin' },
  { file: 'mix.exs', language: 'elixir' },
];

/**
 * Lightweight language detection from manifest files. Returns a
 * de-duplicated list so a TS-over-Node repo surfaces as `['typescript']`
 * rather than `['typescript', 'typescript']`. Used by `project-manifest.json`
 * to give agents a "what should I grep" hint without a deep file scan.
 */
export function detectLanguages(projectRoot: string): string[] {
  const found = new Set<string>();
  for (const { file, language } of LANGUAGE_MARKERS) {
    if (fs.existsSync(path.join(projectRoot, file))) found.add(language);
  }

  // If TypeScript wasn't indicated by tsconfig but package.json exists,
  // distinguish ts-vs-plain-js. Cheap heuristic: look for any .ts file
  // marker in package.json (typescript dep or "types" field).
  if (found.has('typescript')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (!deps.typescript && !pkg.types && !fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) {
        found.delete('typescript');
        found.add('javascript');
      }
    } catch { /* keep default */ }
  }

  return [...found];
}
