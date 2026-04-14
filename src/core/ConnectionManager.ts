import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { GromeConfig, Connection, ConnectionsFile } from '../types.js';
import { atomicWrite, ensureDir } from '../utils.js';

const GROME_DIR = '.grome';
const CONFIG_FILE = 'config.json';
const CONNECTIONS_FILE = 'connections.json';
const MEMORY_DIR = 'memory';
const ATTACHMENTS_DIR = 'attachments';

export class ConnectionManager {
  /**
   * Initialize .grome/ in a project directory. Safe to re-run.
   */
  static async init(projectRoot: string): Promise<GromeConfig> {
    const gromeDir = path.join(projectRoot, GROME_DIR);
    const configPath = path.join(gromeDir, CONFIG_FILE);
    const connectionsPath = path.join(gromeDir, CONNECTIONS_FILE);
    const memoryDir = path.join(gromeDir, MEMORY_DIR);

    ensureDir(gromeDir);
    ensureDir(memoryDir);
    ensureDir(path.join(gromeDir, ATTACHMENTS_DIR));

    // Don't overwrite existing config
    let config: GromeConfig;
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } else {
      config = {
        version: 1,
        projectId: crypto.randomBytes(4).toString('hex'),
        deny: [
          '.env*',
          'node_modules/**',
          '.git/**',
          '*.secret',
          'credentials.*',
        ],
        extractors: {
          routes: true,
          types: true,
          schemas: true,
          handoffs: true,
        },
      };
      await atomicWrite(configPath, JSON.stringify(config, null, 2));
    }

    // Don't overwrite existing connections
    if (!fs.existsSync(connectionsPath)) {
      const connections: ConnectionsFile = { connections: [] };
      await atomicWrite(connectionsPath, JSON.stringify(connections, null, 2));
    }

    // Add .grome/ to .gitignore
    ConnectionManager.addToGitignore(projectRoot);

    return config;
  }

  /**
   * Read config from a project.
   */
  static readConfig(projectRoot: string): GromeConfig {
    const configPath = path.join(projectRoot, GROME_DIR, CONFIG_FILE);
    if (!fs.existsSync(configPath)) {
      throw new Error(`No .grome/config.json found in ${projectRoot}. Run \`grome init\` first.`);
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }

  /**
   * Read connections from a project.
   */
  static readConnections(projectRoot: string): ConnectionsFile {
    const connectionsPath = path.join(projectRoot, GROME_DIR, CONNECTIONS_FILE);
    if (!fs.existsSync(connectionsPath)) {
      return { connections: [] };
    }
    return JSON.parse(fs.readFileSync(connectionsPath, 'utf-8'));
  }

  /**
   * Add a bidirectional connection between two projects.
   */
  static async link(sourceRoot: string, targetRoot: string): Promise<void> {
    // Init both projects
    const sourceConfig = await ConnectionManager.init(sourceRoot);
    const targetConfig = await ConnectionManager.init(targetRoot);

    const sourceName = ConnectionManager.getProjectName(sourceRoot);
    const targetName = ConnectionManager.getProjectName(targetRoot);
    const now = new Date().toISOString();

    // Add target to source's connections
    await ConnectionManager.addConnection(sourceRoot, {
      projectId: targetConfig.projectId,
      name: targetName,
      path: targetRoot,
      linked: now,
    });

    // Add source to target's connections
    await ConnectionManager.addConnection(targetRoot, {
      projectId: sourceConfig.projectId,
      name: sourceName,
      path: sourceRoot,
      linked: now,
    });
  }

  /**
   * Remove a bidirectional connection.
   */
  static async unlink(sourceRoot: string, targetRoot: string): Promise<void> {
    const targetConfig = ConnectionManager.readConfig(targetRoot);
    const sourceConfig = ConnectionManager.readConfig(sourceRoot);

    // Remove from source
    await ConnectionManager.removeConnection(sourceRoot, targetConfig.projectId);

    // Remove from target (if accessible)
    if (fs.existsSync(targetRoot)) {
      await ConnectionManager.removeConnection(targetRoot, sourceConfig.projectId);
    }
  }

  /**
   * Get all project roots that are part of this connection graph (including self).
   */
  static getAllProjectRoots(projectRoot: string): string[] {
    const connections = ConnectionManager.readConnections(projectRoot);
    const roots = [path.resolve(projectRoot)];

    for (const conn of connections.connections) {
      if (fs.existsSync(conn.path)) {
        roots.push(conn.path);
      }
    }

    return roots;
  }

  /**
   * Check if a .grome/ directory exists.
   */
  static isInitialized(projectRoot: string): boolean {
    return fs.existsSync(path.join(projectRoot, GROME_DIR, CONFIG_FILE));
  }

  /**
   * Get the project name from directory name.
   */
  static getProjectName(projectRoot: string): string {
    // Try package.json name first
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name) return pkg.name;
      } catch {
        // fall through
      }
    }
    return path.basename(projectRoot);
  }

  /**
   * Get the memory directory path.
   */
  static getMemoryDir(projectRoot: string): string {
    return path.join(projectRoot, GROME_DIR, MEMORY_DIR);
  }

  /**
   * Get the .grome directory path.
   */
  static getGromeDir(projectRoot: string): string {
    return path.join(projectRoot, GROME_DIR);
  }

  // ── Private helpers ──

  private static async addConnection(projectRoot: string, connection: Connection): Promise<void> {
    const connectionsPath = path.join(projectRoot, GROME_DIR, CONNECTIONS_FILE);
    const data = ConnectionManager.readConnections(projectRoot);

    // Don't duplicate — update if same projectId
    const existing = data.connections.findIndex((c) => c.projectId === connection.projectId);
    if (existing >= 0) {
      data.connections[existing] = connection;
    } else {
      data.connections.push(connection);
    }

    await atomicWrite(connectionsPath, JSON.stringify(data, null, 2));
  }

  private static async removeConnection(projectRoot: string, projectId: string): Promise<void> {
    const connectionsPath = path.join(projectRoot, GROME_DIR, CONNECTIONS_FILE);
    const data = ConnectionManager.readConnections(projectRoot);

    data.connections = data.connections.filter((c) => c.projectId !== projectId);

    await atomicWrite(connectionsPath, JSON.stringify(data, null, 2));
  }

  private static addToGitignore(projectRoot: string): void {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const entry = '.grome/';

    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (!content.includes(entry)) {
        const newContent = content.endsWith('\n')
          ? content + entry + '\n'
          : content + '\n' + entry + '\n';
        fs.writeFileSync(gitignorePath, newContent);
      }
    } else {
      // Only create .gitignore if this looks like a git repo
      if (fs.existsSync(path.join(projectRoot, '.git'))) {
        fs.writeFileSync(gitignorePath, entry + '\n');
      }
    }
  }
}
