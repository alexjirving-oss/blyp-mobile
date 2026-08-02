import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

import { acquireTaskLease, LeaseConflictError } from '../src/lease.js';

async function repositoryFixture(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'blyp-lease-test-'));
}

const CONTRACT_SHA = 'a'.repeat(64);

test('task lease grants one controller exclusive local ownership', async (t) => {
  const repository = await repositoryFixture();
  t.after(async () => {
    await rm(repository, { recursive: true, force: true });
  });
  const first = await acquireTaskLease({
    repository,
    taskId: 'lease-test',
    runId: 'run-one',
    contractSha256: CONTRACT_SHA,
    ttlMs: 5_000,
    heartbeatMs: 1_000,
  });
  await assert.rejects(
    acquireTaskLease({
      repository,
      taskId: 'lease-test',
      runId: 'run-two',
      contractSha256: CONTRACT_SHA,
      ttlMs: 5_000,
      heartbeatMs: 1_000,
    }),
    (error: unknown) =>
      error instanceof LeaseConflictError && error.current.runId === 'run-one',
  );
  await first.release();

  const second = await acquireTaskLease({
    repository,
    taskId: 'lease-test',
    runId: 'run-two',
    contractSha256: CONTRACT_SHA,
    ttlMs: 5_000,
    heartbeatMs: 1_000,
  });
  await second.release();
});

test('task lease heartbeat renews ownership before expiry', async (t) => {
  const repository = await repositoryFixture();
  t.after(async () => {
    await rm(repository, { recursive: true, force: true });
  });
  const lease = await acquireTaskLease({
    repository,
    taskId: 'heartbeat-test',
    runId: 'heartbeat-run',
    contractSha256: CONTRACT_SHA,
    ttlMs: 150,
    heartbeatMs: 30,
  });
  const initialExpiry = Date.parse(lease.record.expiresAt);
  await new Promise((resolve) => setTimeout(resolve, 80));
  lease.assertHealthy();
  assert.ok(Date.parse(lease.record.expiresAt) > initialExpiry);
  await lease.release();
});

test('task lease reclaims a live-dated lease whose local owner process exited', async (t) => {
  const repository = await repositoryFixture();
  t.after(async () => {
    await rm(repository, { recursive: true, force: true });
  });
  const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
  const deadPid = child.pid;
  assert.notEqual(deadPid, undefined);
  await once(child, 'exit');

  const lockDirectory = path.join(
    repository,
    '.accountability',
    'leases',
    'dead-holder-test.lock',
  );
  await mkdir(lockDirectory, { recursive: true });
  const now = new Date().toISOString();
  await writeFile(
    path.join(lockDirectory, 'owner.json'),
    `${JSON.stringify({
      version: 1,
      taskId: 'dead-holder-test',
      runId: 'interrupted-run',
      contractSha256: CONTRACT_SHA,
      leaseToken: 'interrupted-token',
      holder: `${os.hostname()}:${deadPid}:interrupted-run`,
      acquiredAt: now,
      heartbeatAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })}\n`,
  );

  const replacement = await acquireTaskLease({
    repository,
    taskId: 'dead-holder-test',
    runId: 'replacement-run',
    contractSha256: CONTRACT_SHA,
    ttlMs: 5_000,
    heartbeatMs: 1_000,
  });
  assert.equal(replacement.reclaimReason, 'dead-local-holder');
  assert.equal(replacement.reclaimedRecord?.runId, 'interrupted-run');
  await replacement.release();
});
