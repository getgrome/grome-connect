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
