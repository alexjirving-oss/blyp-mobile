import path from 'node:path';

import type { TaskContract } from './types.js';

export const CONTROL_PLANE_PATHS = [
  'tools/accountability/**',
  '.github/workflows/**',
  '.github/CODEOWNERS',
  '.cursor/**',
  'AGENTS.md',
  '**/AGENTS.md',
  '.gitmodules',
  '.accountability/**',
] as const;

export interface PathPolicyResult {
  allowed: boolean;
  normalizedFiles: string[];
  violations: string[];
}

export function normalizeRepoPath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    normalized.length === 0 ||
    normalized.includes('\0') ||
    path.posix.isAbsolute(normalized) ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`Unsafe repository path: ${JSON.stringify(value)}`);
  }
  return normalized;
}

function escapeRegex(character: string): string {
  return /[\\^$+?.()|[\]{}]/.test(character) ? `\\${character}` : character;
}

export function globMatches(patternValue: string, fileValue: string): boolean {
  const pattern = normalizeRepoPath(patternValue);
  const file = normalizeRepoPath(fileValue);
  let expression = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? '';
    if (character === '*') {
      const next = pattern[index + 1];
      if (next === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          expression += '(?:.*/)?';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += escapeRegex(character);
    }
  }

  expression += '$';
  return new RegExp(expression).test(file);
}

function matchesAny(patterns: readonly string[], file: string): boolean {
  return patterns.some((pattern) => globMatches(pattern, file));
}

export function evaluateChangedPaths(
  files: string[],
  contract: TaskContract,
  additionalProtectedPaths: string[] = [],
): PathPolicyResult {
  const violations: string[] = [];
  const normalizedFiles: string[] = [];
  const seen = new Set<string>();
  const protectedPaths = [...CONTROL_PLANE_PATHS, ...additionalProtectedPaths];

  for (const rawFile of files) {
    let file: string;
    try {
      file = normalizeRepoPath(rawFile);
    } catch (error) {
      violations.push(error instanceof Error ? error.message : `Unsafe path: ${rawFile}`);
      continue;
    }
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    normalizedFiles.push(file);

    if (matchesAny(protectedPaths, file)) {
      violations.push(`${file}: modifies accountability control-plane code`);
      continue;
    }
    if (matchesAny(contract.forbiddenPaths, file)) {
      violations.push(`${file}: matches a forbidden task path`);
      continue;
    }
    if (!matchesAny(contract.allowedPaths, file)) {
      violations.push(`${file}: falls outside the task's allowed scope`);
    }
  }

  normalizedFiles.sort();
  return {
    allowed: violations.length === 0,
    normalizedFiles,
    violations,
  };
}

export function readOnlyViolations(files: string[]): string[] {
  return files
    .map((file) => normalizeRepoPath(file))
    .sort()
    .map((file) => `${file}: read-only agent modified its workspace`);
}
