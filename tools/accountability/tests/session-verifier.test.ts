import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { currentHead } from '../src/git.js';
import { readAndValidateVerificationReceipt } from '../src/receipt.js';
import {
  buildSessionVerificationPlan,
  parseSessionState,
  runSessionVerification,
  type SessionState,
  type SessionVerifierDependencies,
} from '../src/session-verifier.js';
import { runProcess, verificationEnvironment } from '../src/process.js';

async function git(cwd: string, args: string[]): Promise<void> {
  const result = await runProcess('git', args, {
    cwd,
    timeoutMs: 30_000,
    env: verificationEnvironment(),
  });
  assert.equal(result.exitCode, 0, result.stderr);
}

async function fixture(t: TestContext, files: string[]): Promise<{
  repository: string;
  sessionPath: string;
  outputRoot: string;
  session: SessionState;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'blyp-session-verifier-test-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const repository = path.join(root, 'repository');
  await mkdir(path.join(repository, 'src'), { recursive: true });
  await git(repository, ['init']);
  await writeFile(path.join(repository, 'src', 'example.ts'), 'export const example = true;\n');
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
  const timestamp = new Date().toISOString();
  const session: SessionState = {
    version: 1,
    sessionId: randomUUID(),
    startedAt: timestamp,
    repoRoot: repository,
    baseSha: await currentHead(repository),
    files: [...files].sort(),
    lastEditAt: files.length === 0 ? null : timestamp,
    editSequence: files.length,
  };
  const sessionPath = path.join(root, 'session.json');
  await writeFile(sessionPath, `${JSON.stringify(session)}\n`);
  return {
    repository,
    sessionPath,
    outputRoot: path.join(root, 'evidence'),
    session,
  };
}

function fakeDependencies(
  verdict: 'PASS' | 'REJECT' | 'BLOCKED' = 'PASS',
): SessionVerifierDependencies {
  return {
    runStep: async (step, _cwd, evidence, prefix) => {
      const timestamp = new Date().toISOString();
      const stdout = await evidence.writeText(`${prefix}/${step.id}.stdout.log`, 'verified\n');
      const stderr = await evidence.writeText(`${prefix}/${step.id}.stderr.log`, '');
      return {
        stepId: step.id,
        runner: step.runner,
        executable: process.execPath,
        args: step.args,
        processArgs: step.args,
        startedAt: timestamp,
        finishedAt: timestamp,
        durationMs: 0,
        exitCode: verdict === 'PASS' ? 0 : verdict === 'REJECT' ? 1 : null,
        signal: null,
        timedOut: verdict === 'BLOCKED',
        spawnError: verdict === 'BLOCKED' ? 'simulated infrastructure failure' : null,
        stdout,
        stderr,
        verdict,
      };
    },
  };
}

test('session state rejects unknown fields and malformed paths', () => {
  const timestamp = new Date().toISOString();
  assert.throws(
    () =>
      parseSessionState({
        version: 1,
        sessionId: randomUUID(),
        startedAt: timestamp,
        repoRoot: process.cwd(),
        baseSha: 'a'.repeat(40),
        files: ['../escape.ts'],
        lastEditAt: timestamp,
        editSequence: 1,
        ignored: true,
      }),
    /unknown property/,
  );
});

test('verification plan covers control-plane, hooks, client, functions, and backend', () => {
  const steps = buildSessionVerificationPlan(process.cwd(), [
    '.cursor/hooks/on_stop_verify.py',
    'src/example.ts',
    'functions/src/index.ts',
    'backend/blyp-live-service/src/index.ts',
  ]);
  assert.deepEqual(
    steps.map((entry) => entry.step.id),
    [
      'accountability-controller',
      'accountability-hooks',
      'client-lint',
      'client-typecheck',
      'client-tests',
      'functions-build',
      'backend-typecheck',
    ],
  );
});

test('session verification emits a fresh, independently valid receipt', async (t) => {
  const setup = await fixture(t, ['src/example.ts']);
  const result = await runSessionVerification(
    {
      repositoryPath: setup.repository,
      sessionPath: setup.sessionPath,
      outputRoot: setup.outputRoot,
    },
    fakeDependencies(),
  );
  assert.equal(result.receipt.outcome.verdict, 'PASS');
  assert.equal(result.receipt.commands.length, 3);
  const validated = await readAndValidateVerificationReceipt(result.receiptPath, {
    receiptDirectory: path.dirname(result.receiptPath),
    repositoryPath: setup.repository,
    sessionPath: setup.sessionPath,
    maxAgeMs: 60_000,
  });
  assert.equal(validated.receiptId, result.receipt.receiptId);
});

test('session verification classifies deterministic failures as rejection', async (t) => {
  const setup = await fixture(t, ['src/example.ts']);
  const result = await runSessionVerification(
    {
      repositoryPath: setup.repository,
      sessionPath: setup.sessionPath,
      outputRoot: setup.outputRoot,
    },
    fakeDependencies('REJECT'),
  );
  assert.equal(result.receipt.outcome.verdict, 'REJECTED');
});

test('session verification classifies timeout or crash as blocked', async (t) => {
  const setup = await fixture(t, ['src/example.ts']);
  const result = await runSessionVerification(
    {
      repositoryPath: setup.repository,
      sessionPath: setup.sessionPath,
      outputRoot: setup.outputRoot,
    },
    fakeDependencies('BLOCKED'),
  );
  assert.equal(result.receipt.outcome.verdict, 'BLOCKED');
});

test('a no-change session still emits a fresh PASS receipt', async (t) => {
  const setup = await fixture(t, []);
  const result = await runSessionVerification(
    {
      repositoryPath: setup.repository,
      sessionPath: setup.sessionPath,
      outputRoot: setup.outputRoot,
    },
    fakeDependencies(),
  );
  assert.equal(result.receipt.outcome.verdict, 'PASS');
  assert.equal(result.receipt.outcome.reasonCode, 'NO_RECORDED_CODE_CHANGES');
  assert.equal(result.receipt.commands.length, 0);
});

test('worktree reconciliation catches an edit missing from hook state', async (t) => {
  const setup = await fixture(t, []);
  await writeFile(
    path.join(setup.repository, 'src', 'example.ts'),
    'export const example = false;\n',
  );
  const result = await runSessionVerification(
    {
      repositoryPath: setup.repository,
      sessionPath: setup.sessionPath,
      outputRoot: setup.outputRoot,
    },
    fakeDependencies(),
  );
  assert.equal(result.receipt.touchedFiles.source, 'session+worktree');
  assert.deepEqual(
    result.receipt.touchedFiles.files.map((file) => file.path),
    ['src/example.ts'],
  );
  assert.equal(result.receipt.commands.length, 3);
});
