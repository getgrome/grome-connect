import type { ExtractedType } from '../types.js';

/**
 * Extract exported TypeScript interfaces and type aliases.
 */
export function extractTypes(
  content: string,
  filePath: string,
  projectName: string
): ExtractedType[] {
  const types: ExtractedType[] = [];

  // Match: export interface Foo { ... }
  const interfaceRegex = /export\s+interface\s+(\w+)(?:\s+extends\s+[\w<>,\s]+)?\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = interfaceRegex.exec(content)) !== null) {
    const name = match[1];
    const startIndex = match.index + match[0].length - 1; // position of opening {
    const body = extractBracedBlock(content, startIndex);

    if (body !== null) {
      types.push({
        name,
        source: projectName,
        file: filePath,
        definition: body,
        exported: true,
        confidence: 0.98,
      });
    }
  }

  // Match: export type Foo = { ... }
  const typeAliasRegex = /export\s+type\s+(\w+)(?:<[^>]+>)?\s*=\s*/g;
  while ((match = typeAliasRegex.exec(content)) !== null) {
    const name = match[1];
    const afterEquals = match.index + match[0].length;

    // Check if it's a braced block type
    const remaining = content.slice(afterEquals).trimStart();
    if (remaining.startsWith('{')) {
      const bodyStart = content.indexOf('{', afterEquals);
      const body = extractBracedBlock(content, bodyStart);
      if (body !== null) {
        types.push({
          name,
          source: projectName,
          file: filePath,
          definition: body,
          exported: true,
          confidence: 0.95,
        });
      }
    } else {
      // Non-braced type alias (e.g., union, intersection, primitive)
      const endMatch = remaining.match(/^([^;]+);/);
      if (endMatch) {
        types.push({
          name,
          source: projectName,
          file: filePath,
          definition: endMatch[1].trim(),
          exported: true,
          confidence: 0.90,
        });
      }
    }
  }

  return types;
}

/**
 * Extract a braced block { ... } handling nested braces.
 * Returns the content between (and including) the braces, or null if unmatched.
 */
function extractBracedBlock(content: string, startIndex: number): string | null {
  if (content[startIndex] !== '{') return null;

  let depth = 0;
  let i = startIndex;

  while (i < content.length) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) {
        const block = content.slice(startIndex, i + 1);
        // Clean up: normalize whitespace inside the block
        return block
          .replace(/^\{/, '')
          .replace(/\}$/, '')
          .trim()
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .join(' ');
      }
    }
    i++;
  }

  return null;
}
