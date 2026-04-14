import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExtractedRoute, Framework } from '../types.js';

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'];

/**
 * Extract routes from Express-style code.
 * Matches: app.get('/path', ...) and router.post('/path', ...)
 */
function extractExpressRoutes(
  content: string,
  filePath: string,
  projectName: string
): ExtractedRoute[] {
  const routes: ExtractedRoute[] = [];
  const methodPattern = HTTP_METHODS.join('|');
  // Match app.get('/path' or router.post("/path"
  const regex = new RegExp(
    `(?:app|router)\\.(${methodPattern})\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]`,
    'g'
  );

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];

    // Extract route params like :id
    const params = (routePath.match(/:(\w+)/g) || []).map((p) => p.slice(1));

    routes.push({
      method,
      path: routePath,
      source: projectName,
      file: filePath,
      params,
      confidence: 0.95,
    });
  }

  return routes;
}

/**
 * Extract routes from Next.js App Router route handler files.
 */
function extractNextRoutes(
  content: string,
  filePath: string,
  projectName: string
): ExtractedRoute[] {
  const routes: ExtractedRoute[] = [];

  // Only process route.ts/js files
  const basename = path.basename(filePath);
  if (!basename.match(/^route\.(ts|js|tsx|jsx)$/)) {
    return routes;
  }

  // Derive the route path from the file path
  // e.g., app/api/users/[id]/route.ts -> /api/users/[id]
  const appMatch = filePath.match(/app[/\\](.+)[/\\]route\.(ts|js|tsx|jsx)$/);
  if (!appMatch) return routes;

  let routePath = '/' + appMatch[1].replace(/\\/g, '/');

  // Convert [param] to :param for consistency
  const params: string[] = [];
  routePath = routePath.replace(/\[([^\]]+)\]/g, (_, param) => {
    params.push(param);
    return `:${param}`;
  });

  // Check which HTTP methods are exported
  const methodExports = HTTP_METHODS.map((m) => m.toUpperCase());
  for (const method of methodExports) {
    // Match: export async function GET, export function POST, export const GET
    const exportRegex = new RegExp(
      `export\\s+(?:async\\s+)?(?:function|const)\\s+${method}\\b`
    );
    if (exportRegex.test(content)) {
      routes.push({
        method,
        path: routePath,
        source: projectName,
        file: filePath,
        params,
        confidence: 0.98,
      });
    }
  }

  return routes;
}

/**
 * Extract all routes from a file based on detected framework.
 */
export function extractRoutes(
  content: string,
  filePath: string,
  projectName: string,
  framework: Framework
): ExtractedRoute[] {
  const routes: ExtractedRoute[] = [];

  if (framework === 'next') {
    routes.push(...extractNextRoutes(content, filePath, projectName));
  }

  // Always try Express patterns — many projects use Express-style routers
  routes.push(...extractExpressRoutes(content, filePath, projectName));

  return routes;
}
