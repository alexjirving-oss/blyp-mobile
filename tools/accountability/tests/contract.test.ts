import assert from 'node:assert/strict';
import test from 'node:test';

import { parseContract } from '../src/contract.js';
import { validContract } from './fixtures.js';

test('accepts a complete accountability contract', () => {
  const contract = parseContract(validContract());
  assert.equal(contract.version, 1);
  assert.equal(contract.swarm.builders.length, 2);
  assert.equal(contract.swarm.reviewers.filter((role) => role.required).length, 2);
});

test('rejects unknown properties instead of silently ignoring them', () => {
  const contract = {
    ...validContract(),
    unaccountedEscapeHatch: true,
  };
  assert.throws(() => parseContract(contract), /unknown property "unaccountedEscapeHatch"/);
});

test('requires independent required reviewers', () => {
  const contract = validContract();
  contract.swarm.reviewers[1] = {
    ...contract.swarm.reviewers[1]!,
    required: false,
  };
  assert.throws(() => parseContract(contract), /at least two reviewers must be required/);
});

test('requires two independently accountable builders', () => {
  const contract = validContract();
  contract.swarm.builders[1] = {
    ...contract.swarm.builders[1]!,
    required: false,
  };
  assert.throws(() => parseContract(contract), /at least two builders must be required/);
});

test('rejects repository path traversal', () => {
  const contract = validContract();
  contract.allowedPaths = ['../outside/**'];
  assert.throws(() => parseContract(contract), /path patterns must be repository-relative/);
});

test('verification commands cannot deploy or push', () => {
  const contract = validContract();
  contract.verification[0] = {
    ...contract.verification[0]!,
    runner: 'npm',
    args: ['publish'],
  };
  assert.throws(
    () => parseContract(contract),
    /verification may not publish, deploy, merge, submit, or push/,
  );
});

test('verification cannot invoke an arbitrary shell runner', () => {
  const contract = validContract();
  contract.verification[0] = {
    ...contract.verification[0]!,
    runner: 'bash' as 'node',
    args: ['-c', 'anything'],
  };
  assert.throws(() => parseContract(contract), /expected "npm" or "node"/);
});

test('verification failures explicitly distinguish rejection from blockage', () => {
  const contract = validContract();
  contract.verification[0] = {
    ...contract.verification[0]!,
    onFailure: 'UNKNOWN' as 'REJECT',
  };
  assert.throws(() => parseContract(contract), /expected "REJECT" or "BLOCKED"/);
});
