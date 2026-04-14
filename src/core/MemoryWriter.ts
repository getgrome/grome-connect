import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  GromeConfig,
  ExtractionResult,
  ExtractedRoute,
  ExtractedType,
  ExtractedSchema,
  Connection,
  RouteMapFile,
  SharedTypesFile,
  ApiSchemasFile,
  ProjectManifest,
  Framework,
} from '../types.js';
import { ConnectionManager } from './ConnectionManager.js';
import { Scanner } from './Scanner.js';
import { PermissionChecker } from './PermissionChecker.js';
import { AgentConfigInjector } from './AgentConfigInjector.js';
import { extractRoutes } from '../extractors/routes.js';
import { extractTypes } from '../extractors/types.js';
import { extractSchemas } from '../extractors/schemas.js';
import { detectFramework } from '../extractors/detection.js';
import { atomicWrite, ensureDir } from '../utils.js';
import { AutoHandoff } from './AutoHandoff.js';

interface ProjectScanResult {
  name: string;
  root: string;
  framework: Framework;
  extraction: ExtractionResult;
}

export class MemoryWriter {
  /**
   * Scan all connected projects and write memory files everywhere.
   * Returns scan results for CLI output.
   */
  static async sync(
    projectRoot: string,
    onProjectStart?: (name: string) => void,
    onProjectResult?: (name: string, result: ExtractionResult, framework: Framework) => void
  ): Promise<{
    projects: ProjectScanResult[];
    totalRoutes: number;
    totalTypes: number;
    totalSchemas: number;
    updatedConfigs: Map<string, string[]>;
    autoHandoffs: import('../types.js').Handoff[];
  }> {
    const resolvedRoot = path.resolve(projectRoot);
    const allRoots = ConnectionManager.getAllProjectRoots(resolvedRoot);

    // Phase 1: Scan all projects
    const scanResults: ProjectScanResult[] = [];
    const allRoutes: ExtractedRoute[] = [];
    const allTypes: ExtractedType[] = [];
    const allSchemas: ExtractedSchema[] = [];

    for (const root of allRoots) {
      const name = ConnectionManager.getProjectName(root);
      onProjectStart?.(name);

      const config = ConnectionManager.readConfig(root);
      const framework = detectFramework(root);
      const extraction = await MemoryWriter.scanProject(root, config, framework, name);

      allRoutes.push(...extraction.routes);
      allTypes.push(...extraction.types);
      allSchemas.push(...extraction.schemas);

      scanResults.push({ name, root, framework, extraction });
      onProjectResult?.(name, extraction, framework);
    }

    // Phase 1.5: Auto-handoff — diff against previous sync and generate handoffs for changes
    const autoHandoffs: import('../types.js').Handoff[] = [];
    for (const result of scanResults) {
      try {
        const handoffs = await AutoHandoff.processSync(
          result.root,
          result.extraction.routes,
          result.extraction.types,
          result.extraction.schemas,
        );
        autoHandoffs.push(...handoffs);
      } catch { /* auto-handoff is best-effort */ }
    }

    // Phase 2: Write memory to every project
    const now = new Date().toISOString();
    const updatedConfigs = new Map<string, string[]>();

    for (const root of allRoots) {
      const name = ConnectionManager.getProjectName(root);
      const connections = ConnectionManager.readConnections(root);
      const connectionsWithFramework = connections.connections.map((conn) => {
        const scanResult = scanResults.find((s) => s.root === conn.path);
        return { ...conn, framework: scanResult?.framework ?? null };
      });

      await MemoryWriter.writeMemoryFiles(root, name, {
        routes: allRoutes,
        types: allTypes,
        schemas: allSchemas,
        connections: connectionsWithFramework,
        now,
      });

      // Phase 3: Update agent config files
      const updated = AgentConfigInjector.inject(root);
      if (updated.length > 0) {
        updatedConfigs.set(name, updated);
      }
    }

    return {
      projects: scanResults,
      totalRoutes: allRoutes.length,
      totalTypes: allTypes.length,
      totalSchemas: allSchemas.length,
      updatedConfigs,
      autoHandoffs,
    };
  }

  /**
   * Scan a single project and extract routes, types, and schemas.
   */
  private static async scanProject(
    root: string,
    config: GromeConfig,
    framework: Framework,
    projectName: string
  ): Promise<ExtractionResult> {
    const scanner = new Scanner(root, config);
    const routes: ExtractedRoute[] = [];
    const types: ExtractedType[] = [];
    const schemas: ExtractedSchema[] = [];

    // Get scannable files
    const files = await scanner.scan();

    for (const relPath of files) {
      const absPath = path.join(root, relPath);

      // Only read text files we can extract from
      if (!relPath.match(/\.(ts|js|tsx|jsx|prisma)$/)) continue;

      let content: string;
      try {
        content = fs.readFileSync(absPath, 'utf-8');
      } catch {
        continue; // Skip unreadable files
      }

      if (config.extractors.routes) {
        routes.push(...extractRoutes(content, relPath, projectName, framework));
      }

      if (config.extractors.types && relPath.match(/\.(ts|tsx)$/)) {
        types.push(...extractTypes(content, relPath, projectName));
      }

      if (config.extractors.schemas) {
        schemas.push(...extractSchemas(content, relPath, projectName));
      }
    }

    return { routes, types, schemas, framework };
  }

  /**
   * Write all memory files to a project's .grome/memory/ directory.
   */
  private static async writeMemoryFiles(
    projectRoot: string,
    projectName: string,
    data: {
      routes: ExtractedRoute[];
      types: ExtractedType[];
      schemas: ExtractedSchema[];
      connections: Array<Connection & { framework: Framework }>;
      now: string;
    }
  ): Promise<void> {
    const memoryDir = ConnectionManager.getMemoryDir(projectRoot);
    ensureDir(memoryDir);

    // route-map.json
    const routeMap: RouteMapFile = {
      version: 1,
      generatedAt: data.now,
      routes: data.routes,
    };
    await atomicWrite(
      path.join(memoryDir, 'route-map.json'),
      JSON.stringify(routeMap, null, 2)
    );

    // shared-types.json
    const sharedTypes: SharedTypesFile = {
      version: 1,
      generatedAt: data.now,
      types: data.types,
    };
    await atomicWrite(
      path.join(memoryDir, 'shared-types.json'),
      JSON.stringify(sharedTypes, null, 2)
    );

    // api-schemas.json
    const apiSchemas: ApiSchemasFile = {
      version: 1,
      generatedAt: data.now,
      schemas: data.schemas,
    };
    await atomicWrite(
      path.join(memoryDir, 'api-schemas.json'),
      JSON.stringify(apiSchemas, null, 2)
    );

    // project-manifest.json
    const manifest: ProjectManifest = {
      version: 1,
      generatedAt: data.now,
      thisProject: projectName,
      connections: data.connections,
      stats: {
        routes: data.routes.length,
        types: data.types.length,
        schemas: data.schemas.length,
      },
    };
    await atomicWrite(
      path.join(memoryDir, 'project-manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    // README.md
    const connectedNames = data.connections.map((c) => c.name).join(', ') || 'none';
    const readme = `# Grome Shared Memory

Cross-project context generated by Grome Connect.
Do not edit — overwritten on each sync.

## Files
- route-map.json — API routes from connected projects
- shared-types.json — TypeScript types and interfaces
- api-schemas.json — Validation schemas (Zod, Prisma)
- project-manifest.json — Connection metadata

## Usage
Read these files to understand the API surface of connected projects.
Use route-map.json for endpoint paths and methods.
Use shared-types.json for response/request type shapes.

Last synced: ${data.now}
Connected projects: ${connectedNames}
`;
    await atomicWrite(path.join(memoryDir, 'README.md'), readme);
  }

  /**
   * Clear memory files from a project.
   */
  static async clearMemory(projectRoot: string): Promise<void> {
    const memoryDir = ConnectionManager.getMemoryDir(projectRoot);
    if (!fs.existsSync(memoryDir)) return;

    const files = ['route-map.json', 'shared-types.json', 'api-schemas.json', 'project-manifest.json', 'README.md'];
    for (const file of files) {
      const filePath = path.join(memoryDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }
}
