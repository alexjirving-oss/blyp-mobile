import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { canonicalJson, sha256 } from '../src/canonical.js';
import {
  parseVerificationReceipt,
  readAndValidateVerificationReceipt,
  sealVerificationReceipt,
  VERIFICATION_RECEIPT_SCHEMA,
  VERIFICATION_RECEIPT_VERSION,
  type UnsignedVerificationReceipt,
} from '../src/receipt.js';

function unsignedReceipt(finishedAt = new Date().toISOString()): UnsignedVerificationReceipt {
  const files: [] = [];
  return {
    schema: VERIFICATION_RECEIPT_SCHEMA,
    version: VERIFICATION_RECEIPT_VERSION,
    receiptId: 'd87f47d0-924d-4c95-a86e-54d624dd7f42',
    verifier: {
      name: 'receipt-test',
      version: '1.0.0',
      implementation: 'tools/accountability/tests/receipt.test.ts',
      implementationSha256: 'a'.repeat(64),
    },
    binding: {
      repoRoot: path.resolve('.'),
      headSha: 'b'.repeat(40),
      baseSha: 'c'.repeat(40),
      branch: 'test',
      worktreeStatusSha256: 'd'.repeat(64),
      sessionId: 'test-session',
      taskId: 'receipt-test',
      contractSha256: null,
    },
    timing: {
      startedAt: finishedAt,
      finishedAt,
      durationMs: 0,
    },
    touchedFiles: {
      source: 'session.json',
      files,
      pathsSha256: sha256(canonicalJson([])),
      contentSha256: sha256(canonicalJson(files)),
    },
    commands: [],
    artifacts: [],
    outcome: {
      verdict: 'PASS',
      reasonCode: 'VERIFIED',
      parseStatus: 'OK',
    },
    authority: {
      kind: 'local-session',
      signed: false,
      ledgerEventHash: null,
    },
  };
}

test('verification receipt hashing is deterministic and strictly parsed', () => {
  const first = sealVerificationReceipt(unsignedReceipt('2026-08-02T16:00:00.000Z'));
  const second = sealVerificationReceipt(unsignedReceipt('2026-08-02T16:00:00.000Z'));
  assert.equal(first.payloadSha256, second.payloadSha256);
  assert.deepEqual(parseVerificationReceipt(JSON.parse(JSON.stringify(first))), first);
});

test('verification receipt rejects payload tampering', () => {
  const receipt = sealVerificationReceipt(unsignedReceipt());
  const tampered = structuredClone(receipt);
  tampered.outcome.reasonCode = 'FORGED_PASS';
  assert.throws(() => parseVerificationReceipt(tampered), /payload hash mismatch/);
});

test('verification receipt rejects unknown fields', () => {
  const receipt = {
    ...sealVerificationReceipt(unsignedReceipt()),
    silentlyIgnored: true,
  };
  assert.throws(() => parseVerificationReceipt(receipt), /unknown property/);
});

test('receipt file validation detects missing artifacts', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'blyp-receipt-test-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const receipt = sealVerificationReceipt({
    ...unsignedReceipt(),
    artifacts: [
      {
        relativePath: 'commands/missing.stdout.log',
        sha256: 'e'.repeat(64),
        bytes: 1,
      },
    ],
  });
  const receiptPath = path.join(directory, 'receipt.json');
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);
  await assert.rejects(
    readAndValidateVerificationReceipt(receiptPath, { receiptDirectory: directory }),
    /ENOENT|no such file/i,
  );
});

test('receipt file validation rejects stale receipts', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'blyp-receipt-age-test-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const receipt = sealVerificationReceipt(unsignedReceipt('2020-01-01T00:00:00.000Z'));
  const receiptPath = path.join(directory, 'receipt.json');
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);
  await assert.rejects(
    readAndValidateVerificationReceipt(receiptPath, {
      receiptDirectory: directory,
      maxAgeMs: 60_000,
    }),
    /stale/,
  );
});
