import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runProcess, verificationEnvironment } from './process.js';
import type { DiffStat } from './types.js';

const GIT_TIMEOUT_MS = 120_000;

async function git(
  repository: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; trimOutput?: boolean } = {},
): Promise<string> {
  const result = await runProcess('git', args, {
    cwd: options.cwd ?? repository,
    timeoutMs: GIT_TIMEOUT_MS,
    env: options.env ?? verificationEnvironment(),
  });
  if (
    result.spawnError !== null ||
    result.timedOut ||
    result.outputExceeded ||
    result.exitCode !== 0
  ) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`git ${args[0] ?? 'command'} failed${detail.length > 0 ? `: ${detail}` : ''}`);
  }
  return options.trimOutput === false ? result.stdout : result.stdout.trim();
}

function nulSeparated(value: string): string[] {
  return value
    .split('\0')
    .filter((item) => item.length > 0)
    .map((item) => item.replaceAll('\\', '/'));
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = next;
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export async function repositoryRoot(startPath: string): Promise<string> {
  const root = await git(path.resolve(startPath), ['rev-parse', '--show-toplevel']);
  return path.resolve(root);
}

export async function resolveCommit(repository: string, reference: string): Promise<string> {
  const commit = await git(repository, ['rev-parse', '--verify', `${reference}^{commit}`]);
  if (!/^[a-f0-9]{40,64}$/i.test(commit)) {
    throw new Error(`Git returned an invalid commit id for ${reference}`);
  }
  return commit.toLowerCase();
}

export async function currentHead(worktree: string): Promise<string> {
  return await resolveCommit(worktree, 'HEAD');
}

export async function changedFilesFromBase(
  worktree: string,
  baseSha: string,
  options: { includeIgnored?: boolean } = {},
): Promise<string[]> {
  const tracked = await git(
    worktree,
    ['diff', '--name-only', '-z', '--no-renames', baseSha, '--'],
    { trimOutput: false },
  );
  const untracked = await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z'], {
    trimOutput: false,
  });
  const ignored =
    options.includeIgnored === true
      ? await git(worktree, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], {
          trimOutput: false,
        })
      : '';
  return [
    ...new Set([...nulSeparated(tracked), ...nulSeparated(untracked), ...nulSeparated(ignored)]),
  ]
    .filter((file) => file.length > 0)
    .sort();
}

export async function freezeCandidate(
  worktree: string,
  repository: string,
  options: {
    runId: string;
    candidateId: string;
    parentSha: string;
  },
): Promise<string> {
  await git(worktree, ['add', '-A', '--']);
  const tree = await git(worktree, ['write-tree']);
  const timestamp = new Date().toISOString();
  const environment = verificationEnvironment();
  environment.GIT_AUTHOR_NAME = 'Blyp Accountability Controller';
  environment.GIT_AUTHOR_EMAIL = 'accountability@invalid.local';
  environment.GIT_AUTHOR_DATE = timestamp;
  environment.GIT_COMMITTER_NAME = 'Blyp Accountability Controller';
  environment.GIT_COMMITTER_EMAIL = 'accountability@invalid.local';
  environment.GIT_COMMITTER_DATE = timestamp;
  const commit = await git(
    worktree,
    [
      'commit-tree',
      tree,
      '-p',
      options.parentSha,
      '-m',
      `accountability candidate ${options.runId}/${options.candidateId}`,
    ],
    { env: environment },
  );
  if (!/^[a-f0-9]{40,64}$/i.test(commit)) {
    throw new Error('git commit-tree returned an invalid commit id');
  }
  const reference = `refs/accountability/${options.runId}/${options.candidateId}`;
  await git(repository, ['update-ref', reference, commit]);
  return commit.toLowerCase();
}

export async function diffStat(
  worktree: string,
  baseSha: string,
  commitSha: string,
): Promise<DiffStat> {
  const output = await git(worktree, [
    'diff',
    '--numstat',
    '--no-renames',
    baseSha,
    commitSha,
    '--',
  ]);
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of output.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    const [added, removed] = line.split('\t');
    files += 1;
    if (added !== undefined && /^\d+$/.test(added)) {
      insertions += Number.parseInt(added, 10);
    }
    if (removed !== undefined && /^\d+$/.test(removed)) {
      deletions += Number.parseInt(removed, 10);
    }
  }
  return { files, insertions, deletions };
}

export async function candidatePatch(
  worktree: string,
  baseSha: string,
  commitSha: string,
): Promise<string> {
  const result = await runProcess(
    'git',
    ['diff', '--binary', '--full-index', '--no-renames', baseSha, commitSha, '--'],
    {
      cwd: worktree,
      timeoutMs: GIT_TIMEOUT_MS,
      env: verificationEnvironment(),
      maxOutputBytes: 50 * 1024 * 1024,
    },
  );
  if (
    result.spawnError !== null ||
    result.timedOut ||
    result.outputExceeded ||
    result.exitCode !== 0
  ) {
    throw new Error(
      `candidate patch export failed: ${
        result.stderr.trim() || result.spawnError || 'unknown git error'
      }`,
    );
  }
  return result.stdout;
}

export class WorktreeManager {
  private readonly mutex = new AsyncMutex();
  private readonly active = new Set<string>();
  private readonly root: string;

  constructor(
    private readonly repository: string,
    runId: string,
  ) {
    this.root = path.join(os.tmpdir(), 'blyp-accountability', runId);
  }

  async create(label: string, commitSha: string): Promise<string> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(label)) {
      throw new Error(`Unsafe worktree label: ${label}`);
    }
    return await this.mutex.run(async () => {
      await mkdir(this.root, { recursive: true });
      const destination = path.join(this.root, label);
      await rm(destination, { recursive: true, force: true });
      await git(this.repository, ['worktree', 'add', '--detach', destination, commitSha]);
      this.active.add(destination);
      return destination;
    });
  }

  async remove(worktree: string): Promise<void> {
    await this.mutex.run(async () => {
      if (!this.active.has(worktree)) {
        return;
      }
      await git(this.repository, ['worktree', 'remove', '--force', worktree]);
      this.active.delete(worktree);
    });
  }

  async cleanup(): Promise<string[]> {
    const failures: string[] = [];
    for (const worktree of [...this.active]) {
      try {
        await this.remove(worktree);
      } catch (error) {
        failures.push(`${worktree}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      await this.mutex.run(async () => {
        await git(this.repository, ['worktree', 'prune']);
        await rm(this.root, { recursive: true, force: true });
      });
    } catch (error) {
      failures.push(`worktree prune: ${error instanceof Error ? error.message : String(error)}`);
    }
    return failures;
  }
}
