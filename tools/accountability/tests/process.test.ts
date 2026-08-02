import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { mapLimit } from '../src/concurrency.js';
import { EvidenceStore } from '../src/ledger.js';
import { runProcess, runVerificationStep, verificationEnvironment } from '../src/process.js';

test('process runner captures deterministic command evidence', async () => {
  const result = await runProcess(process.execPath, ['-e', "process.stdout.write('verified')"], {
    cwd: process.cwd(),
    timeoutMs: 10_000,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'verified');
  assert.equal(result.spawnError, null);
});

test('process runner marks timeouts instead of treating them as passes', async () => {
  const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
    cwd: process.cwd(),
    timeoutMs: 50,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});

test('synchronous spawn errors become evidence instead of exceptions', async () => {
  const result = await runProcess('\0invalid-executable', [], {
    cwd: process.cwd(),
    timeoutMs: 1_000,
  });
  assert.equal(result.exitCode, null);
  assert.match(result.spawnError ?? '', /null bytes|without null bytes|invalid/i);
});

test('verification runner invokes npm without a shell command string', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'blyp-process-test-'));
  t.after(async () => {
    await rm(parent, { recursive: true, force: true });
  });
  const evidence = new EvidenceStore(path.join(parent, 'evidence'));
  await evidence.initialize();
  const result = await runVerificationStep(
    {
      id: 'npm-version',
      runner: 'npm',
      args: ['--version'],
      timeoutMs: 30_000,
      required: true,
      onFailure: 'BLOCKED',
      envAllowlist: [],
    },
    process.cwd(),
    evidence,
    'commands',
  );
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.args, ['--version']);
  assert.equal(result.executable, process.execPath);
  assert.match(result.processArgs[0] ?? '', /npm-cli\.js$/i);
});

test('verification environment strips controller credentials', () => {
  const previousCursor = process.env.CURSOR_API_KEY;
  const previousSigning = process.env.ACCOUNTABILITY_SIGNING_PRIVATE_KEY;
  process.env.CURSOR_API_KEY = 'cursor-secret';
  process.env.ACCOUNTABILITY_SIGNING_PRIVATE_KEY = 'ledger-secret';
  try {
    const environment = verificationEnvironment([
      'CURSOR_API_KEY',
      'ACCOUNTABILITY_SIGNING_PRIVATE_KEY',
    ]);
    assert.equal(environment.CURSOR_API_KEY, undefined);
    assert.equal(environment.ACCOUNTABILITY_SIGNING_PRIVATE_KEY, undefined);
  } finally {
    if (previousCursor === undefined) {
      delete process.env.CURSOR_API_KEY;
    } else {
      process.env.CURSOR_API_KEY = previousCursor;
    }
    if (previousSigning === undefined) {
      delete process.env.ACCOUNTABILITY_SIGNING_PRIVATE_KEY;
    } else {
      process.env.ACCOUNTABILITY_SIGNING_PRIVATE_KEY = previousSigning;
    }
  }
});

test('parallel agent utility enforces the configured concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  const values = await mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(values, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});

test('parallel failures wait for peer work before cleanup can begin', async () => {
  let peerFinished = false;
  await assert.rejects(
    mapLimit([1, 2], 2, async (value) => {
      if (value === 1) {
        throw new Error('simulated worker failure');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
      peerFinished = true;
      return value;
    }),
    /parallel operation/,
  );
  assert.equal(peerFinished, true);
});
