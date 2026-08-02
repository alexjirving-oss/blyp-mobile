import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  candidatePatch,
  changedFilesFromBase,
  diffStat,
  freezeCandidate,
  resolveCommit,
  WorktreeManager,
} from '../src/git.js';
import { runProcess, verificationEnvironment } from '../src/process.js';

async function git(cwd: string, args: string[]): Promise<void> {
  const result = await runProcess('git', args, {
    cwd,
    timeoutMs: 30_000,
    env: verificationEnvironment(),
  });
  assert.equal(result.exitCode, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
}

async function repositoryFixture(t: TestContext): Promise<string> {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'blyp-git-test-'));
  t.after(async () => {
    await rm(repository, { recursive: true, force: true });
  });
  await git(repository, ['init']);
  await mkdir(path.join(repository, 'src'));
  await writeFile(path.join(repository, 'src', 'value.ts'), 'export const value = 1;\n');
  await writeFile(path.join(repository, '.gitignore'), 'ignored/\n');
  await git(repository, ['add', '-A']);
  await git(repository, [
    '-c',
    'user.name=Accountability Test',
    '-c',
    'user.email=accountability-test@invalid.local',
    'commit',
    '-m',
    'baseline',
  ]);
  return repository;
}

test('controller freezes and exports an attributable candidate', async (t) => {
  const repository = await repositoryFixture(t);
  const baseSha = await resolveCommit(repository, 'HEAD');
  const manager = new WorktreeManager(repository, `git-test-${Date.now()}`);
  const worktree = await manager.create('builder-a', baseSha);

  await writeFile(path.join(worktree, 'src', 'value.ts'), 'export const value = 2;\n');
  assert.deepEqual(await changedFilesFromBase(worktree, baseSha), ['src/value.ts']);
  const commitSha = await freezeCandidate(worktree, repository, {
    runId: 'git-test',
    candidateId: 'builder-a-a0',
    parentSha: baseSha,
  });
  assert.notEqual(commitSha, baseSha);
  const stats = await diffStat(worktree, baseSha, commitSha);
  assert.deepEqual(stats, { files: 1, insertions: 1, deletions: 1 });
  const patch = await candidatePatch(worktree, baseSha, commitSha);
  assert.match(patch, /export const value = 2/);

  const cleanup = await manager.cleanup();
  assert.deepEqual(cleanup, []);
});

test('untracked files are included in candidate accountability', async (t) => {
  const repository = await repositoryFixture(t);
  const baseSha = await resolveCommit(repository, 'HEAD');
  const manager = new WorktreeManager(repository, `git-test-${Date.now()}`);
  const worktree = await manager.create('builder-b', baseSha);
  await writeFile(path.join(worktree, 'src', 'new.ts'), 'export const added = true;\n');
  assert.deepEqual(await changedFilesFromBase(worktree, baseSha), ['src/new.ts']);
  assert.deepEqual(await manager.cleanup(), []);
});

test('read-only audits can detect ignored workspace side effects', async (t) => {
  const repository = await repositoryFixture(t);
  const baseSha = await resolveCommit(repository, 'HEAD');
  const manager = new WorktreeManager(repository, `git-test-${Date.now()}`);
  const worktree = await manager.create('reviewer', baseSha);
  await mkdir(path.join(worktree, 'ignored'));
  await writeFile(path.join(worktree, 'ignored', 'side-effect.txt'), 'unexpected\n');

  assert.deepEqual(await changedFilesFromBase(worktree, baseSha), []);
  assert.deepEqual(await changedFilesFromBase(worktree, baseSha, { includeIgnored: true }), [
    'ignored/side-effect.txt',
  ]);
  assert.deepEqual(await manager.cleanup(), []);
});
