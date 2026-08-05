import test from 'node:test';
import assert from 'node:assert/strict';
import { isCanonicalCognitoSub } from './cognitoSub';

test('accepts Cognito UUID-shaped subs including non-RFC variant nibbles', () => {
  assert.equal(isCanonicalCognitoSub('26522274-e001-70aa-51b6-bcbbdffc43bb'), true);
  assert.equal(isCanonicalCognitoSub('06e2a2e4-3011-7017-daf2-0e060e59d4f7'), true);
  assert.equal(isCanonicalCognitoSub('550e8400-e29b-41d4-a716-446655440000'), true);
});

test('rejects non-UUID subjects', () => {
  assert.equal(isCanonicalCognitoSub('alex@tapaquatics.com'), false);
  assert.equal(isCanonicalCognitoSub('not-a-uuid'), false);
  assert.equal(isCanonicalCognitoSub(''), false);
  assert.equal(isCanonicalCognitoSub(null), false);
});
