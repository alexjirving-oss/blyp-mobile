import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  EvidenceStore,
  generateSigningKeyPair,
  parsePrivateSigningKey,
  parsePublicSigningKey,
  SignedLedger,
  verifyLedger,
} from '../src/ledger.js';

const SIGNING_KEYS = generateSigningKeyPair();
const PRIVATE_KEY = parsePrivateSigningKey(SIGNING_KEYS.privateKey);
const PUBLIC_KEY = parsePublicSigningKey(SIGNING_KEYS.publicKey);

async function ledgerFixture(t: TestContext): Promise<{
  directory: string;
  evidence: EvidenceStore;
  ledger: SignedLedger;
  ledgerPath: string;
}> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'blyp-ledger-test-'));
  t.after(async () => {
    await rm(parent, { recursive: true, force: true });
  });
  const directory = path.join(parent, 'run');
  const evidence = new EvidenceStore(directory);
  await evidence.initialize();
  const ledger = new SignedLedger('test-run', directory, PRIVATE_KEY);
  await ledger.initialize();
  return {
    directory,
    evidence,
    ledger,
    ledgerPath: path.join(directory, 'ledger.ndjson'),
  };
}

test('signed ledger forms a verifiable hash chain', async (t) => {
  const fixture = await ledgerFixture(t);
  await fixture.ledger.append({
    actor: 'controller',
    action: 'RUN_CREATED',
    subject: 'test-run',
    payload: { baseSha: 'abc' },
  });
  await fixture.ledger.append({
    actor: 'reviewer',
    action: 'REVIEW_COMPLETED',
    subject: 'candidate-a',
    payload: { verdict: 'PASS' },
  });
  await fixture.ledger.flush();

  const verification = await verifyLedger(fixture.ledgerPath, PUBLIC_KEY);
  assert.equal(verification.valid, true);
  assert.equal(verification.eventCount, 2);
  assert.equal(verification.errors.length, 0);
  const firstEvent = JSON.parse(
    (await readFile(fixture.ledgerPath, 'utf8')).split(/\r?\n/)[0]!,
  ) as { signatureAlgorithm: string; signingKeyId: string };
  assert.equal(firstEvent.signatureAlgorithm, 'Ed25519');
  assert.equal(firstEvent.signingKeyId, SIGNING_KEYS.keyId);
});

test('tampering with an event is detected', async (t) => {
  const fixture = await ledgerFixture(t);
  await fixture.ledger.append({
    actor: 'controller',
    action: 'CANDIDATE_REJECTED',
    subject: 'candidate-a',
    payload: { reason: 'test failure' },
  });
  const original = await readFile(fixture.ledgerPath, 'utf8');
  await writeFile(
    fixture.ledgerPath,
    original.replace('CANDIDATE_REJECTED', 'CANDIDATE_ACCEPTED'),
    'utf8',
  );

  const verification = await verifyLedger(fixture.ledgerPath, PUBLIC_KEY);
  assert.equal(verification.valid, false);
  assert.match(verification.errors.join('\n'), /hash mismatch/);
});

test('a different signing key cannot validate the ledger', async (t) => {
  const fixture = await ledgerFixture(t);
  await fixture.ledger.append({
    actor: 'controller',
    action: 'RUN_CREATED',
    subject: 'test-run',
    payload: {},
  });
  const wrongKeys = generateSigningKeyPair();
  const wrongPublicKey = parsePublicSigningKey(wrongKeys.publicKey);
  const verification = await verifyLedger(fixture.ledgerPath, wrongPublicKey);
  assert.equal(verification.valid, false);
  assert.match(verification.errors.join('\n'), /signature mismatch/);
});

test('malformed events are reported instead of crashing verification', async (t) => {
  const fixture = await ledgerFixture(t);
  await writeFile(fixture.ledgerPath, `${JSON.stringify({ version: 1, hash: null })}\n`, 'utf8');
  const verification = await verifyLedger(fixture.ledgerPath, PUBLIC_KEY);
  assert.equal(verification.valid, false);
  assert.match(verification.errors.join('\n'), /invalid event shape/);
});

test('private and public signing keys cannot be substituted', () => {
  assert.throws(() => parsePrivateSigningKey(SIGNING_KEYS.publicKey), /PRIVATE_KEY/);
  assert.throws(() => parsePublicSigningKey(SIGNING_KEYS.privateKey), /PUBLIC_KEY/);
});

test('evidence files are write-once', async (t) => {
  const fixture = await ledgerFixture(t);
  const reference = await fixture.evidence.writeJson('candidate/result.json', {
    verdict: 'PASS',
  });
  assert.equal(reference.relativePath, 'candidate/result.json');
  await assert.rejects(
    fixture.evidence.writeJson('candidate/result.json', {
      verdict: 'REJECT',
    }),
    /EEXIST/,
  );
});
