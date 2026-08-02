import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
