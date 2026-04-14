import type { ExtractedSchema } from '../types.js';

/**
 * Extract Zod schemas from TypeScript files.
 * Matches: const fooSchema = z.object({ ... })
 */
function extractZodSchemas(
  content: string,
  filePath: string,
  projectName: string
): ExtractedSchema[] {
  const schemas: ExtractedSchema[] = [];

  // Match: const/let/var fooSchema = z.object({
  // Also match: export const fooSchema = z.object({
  const zodRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*z\.object\s*\(\s*\{/g;

  let match: RegExpExecArray | null;
  while ((match = zodRegex.exec(content)) !== null) {
    const name = match[1];
    // Find the start of the object literal
    const objStart = content.indexOf('{', match.index + match[0].length - 1);
    const shape = extractZodShape(content, objStart);

    if (shape !== null) {
      schemas.push({
        name,
        type: 'zod',
        source: projectName,
        file: filePath,
        shape,
        confidence: 0.92,
      });
    }
  }

  return schemas;
}

/**
 * Extract the shape of a Zod object, returning field -> definition map.
 */
function extractZodShape(content: string, startIndex: number): Record<string, string> | null {
  if (content[startIndex] !== '{') return null;

  // Find the matching closing brace
  let depth = 0;
  let i = startIndex;
  while (i < content.length) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }

  if (depth !== 0) return null;

  const block = content.slice(startIndex + 1, i).trim();
  const shape: Record<string, string> = {};

  // Parse each field: key: z.string().min(1),
  const fieldRegex = /(\w+)\s*:\s*(z\.[^,\n}]+)/g;
  let fieldMatch: RegExpExecArray | null;
  while ((fieldMatch = fieldRegex.exec(block)) !== null) {
    shape[fieldMatch[1]] = fieldMatch[2].trim().replace(/,\s*$/, '');
  }

  return Object.keys(shape).length > 0 ? shape : null;
}

/**
 * Extract Prisma models from .prisma files.
 * Matches: model Foo { ... }
 */
function extractPrismaSchemas(
  content: string,
  filePath: string,
  projectName: string
): ExtractedSchema[] {
  const schemas: ExtractedSchema[] = [];

  const modelRegex = /model\s+(\w+)\s*\{/g;

  let match: RegExpExecArray | null;
  while ((match = modelRegex.exec(content)) !== null) {
    const name = match[1];
    const objStart = content.indexOf('{', match.index);

    // Find matching closing brace
    let depth = 0;
    let i = objStart;
    while (i < content.length) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }

    if (depth !== 0) continue;

    const block = content.slice(objStart + 1, i).trim();
    const shape: Record<string, string> = {};

    // Parse Prisma fields: fieldName Type @attributes
    const lines = block.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;

      const fieldMatch = trimmed.match(/^(\w+)\s+(\S+(?:\s+@\S+(?:\([^)]*\))?)*)/);
      if (fieldMatch) {
        shape[fieldMatch[1]] = fieldMatch[2].trim();
      }
    }

    if (Object.keys(shape).length > 0) {
      schemas.push({
        name,
        type: 'prisma',
        source: projectName,
        file: filePath,
        shape,
        confidence: 0.95,
      });
    }
  }

  return schemas;
}

/**
 * Extract all schemas from a file.
 */
export function extractSchemas(
  content: string,
  filePath: string,
  projectName: string
): ExtractedSchema[] {
  const schemas: ExtractedSchema[] = [];

  // Prisma files
  if (filePath.endsWith('.prisma')) {
    schemas.push(...extractPrismaSchemas(content, filePath, projectName));
  }

  // Zod schemas (in any .ts/.js file)
  if (filePath.match(/\.(ts|js|tsx|jsx)$/)) {
    schemas.push(...extractZodSchemas(content, filePath, projectName));
  }

  return schemas;
}
