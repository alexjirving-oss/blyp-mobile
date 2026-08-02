import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  EvidenceStore,
  generateSigningKeyPair,
  parsePrivateSigningKey,
  SignedLedger,
} from '../src/ledger.js';
import { RunStateMachine } from '../src/state-machine.js';

const PRIVATE_KEY = parsePrivateSigningKey(generateSigningKeyPair().privateKey);

test('state machine permits only accountable workflow transitions', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'blyp-state-test-'));
  t.after(async () => {
    await rm(parent, { recursive: true, force: true });
  });
  const directory = path.join(parent, 'run');
  const evidence = new EvidenceStore(directory);
  await evidence.initialize();
  const ledger = new SignedLedger('state-test', directory, PRIVATE_KEY);
  await ledger.initialize();
  const machine = new RunStateMachine(ledger);

  await machine.transition('ANALYZING', 'analysis starts');
  await machine.transition('BUILDING', 'analysis passed');
  await machine.transition('VERIFYING', 'candidates frozen');
  await machine.transition('REPAIRING', 'candidate rejected');
  await machine.transition('VERIFYING', 'repair frozen');
  await machine.transition('ACCEPTED', 'all mandatory gates passed');
  assert.equal(machine.state, 'ACCEPTED');
  await assert.rejects(
    machine.transition('ANALYZING', 'attempt to reopen terminal state'),
    /Illegal accountability state transition/,
  );
});

test('a candidate cannot jump directly from creation to acceptance', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'blyp-state-test-'));
  t.after(async () => {
    await rm(parent, { recursive: true, force: true });
  });
  const directory = path.join(parent, 'run');
  const evidence = new EvidenceStore(directory);
  await evidence.initialize();
  const ledger = new SignedLedger('state-test', directory, PRIVATE_KEY);
  await ledger.initialize();
  const machine = new RunStateMachine(ledger);

  await assert.rejects(
    machine.transition('ACCEPTED', 'unsupported success claim'),
    /Illegal accountability state transition CREATED -> ACCEPTED/,
  );
});
