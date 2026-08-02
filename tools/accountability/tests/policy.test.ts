import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateChangedPaths, globMatches, readOnlyViolations } from '../src/policy.js';
import { validContract } from './fixtures.js';

test('repository glob matching respects directory boundaries', () => {
  assert.equal(globMatches('src/**', 'src/auth/login.ts'), true);
  assert.equal(globMatches('src/*.ts', 'src/login.ts'), true);
  assert.equal(globMatches('src/*.ts', 'src/auth/login.ts'), false);
  assert.equal(globMatches('**/*.test.ts', 'tests/auth/login.test.ts'), true);
});

test('control-plane paths stay protected even under a broad task scope', () => {
  const contract = validContract();
  contract.allowedPaths = ['**'];
  const result = evaluateChangedPaths(
    ['src/feature.ts', 'tools/accountability/src/orchestrator.ts'],
    contract,
  );
  assert.equal(result.allowed, false);
  assert.match(result.violations.join('\n'), /control-plane/);
});

test('forbidden paths override allowed paths', () => {
  const contract = validContract();
  contract.allowedPaths = ['**'];
  contract.forbiddenPaths = ['package.json'];
  const result = evaluateChangedPaths(['package.json'], contract);
  assert.equal(result.allowed, false);
  assert.match(result.violations[0] ?? '', /forbidden/);
});

test('out-of-scope changes are rejected and normalized', () => {
  const result = evaluateChangedPaths(['src\\feature.ts', 'backend/server.ts'], validContract());
  assert.deepEqual(result.normalizedFiles, ['backend/server.ts', 'src/feature.ts']);
  assert.match(result.violations.join('\n'), /outside the task's allowed scope/);
});

test('read-only agents are accountable for every modification', () => {
  assert.deepEqual(readOnlyViolations(['src/b.ts', 'src/a.ts']), [
    'src/a.ts: read-only agent modified its workspace',
    'src/b.ts: read-only agent modified its workspace',
  ]);
});
