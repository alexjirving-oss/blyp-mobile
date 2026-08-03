import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCognitoClaims } from './cognitoClaims';

const CLIENT = '4a7r115hllaedriqsjlsa00snj';

test('accepts access token for known client', () => {
  assert.doesNotThrow(() =>
    validateCognitoClaims(
      { sub: '4652d2f4-d051-70bc-43df-dcca0e61e2c6', token_use: 'access', client_id: CLIENT },
      [CLIENT],
    ),
  );
});

test('accepts id token with aud for known client', () => {
  assert.doesNotThrow(() =>
    validateCognitoClaims(
      { sub: '4652d2f4-d051-70bc-43df-dcca0e61e2c6', token_use: 'id', aud: CLIENT },
      [CLIENT],
    ),
  );
});

test('rejects wrong token_use', () => {
  assert.throws(
    () =>
      validateCognitoClaims(
        { sub: 'x', token_use: 'refresh', client_id: CLIENT },
        [CLIENT],
      ),
    /INVALID_TOKEN_USE/,
  );
});

test('rejects unknown client', () => {
  assert.throws(
    () =>
      validateCognitoClaims(
        { sub: 'x', token_use: 'access', client_id: 'other-client' },
        [CLIENT],
      ),
    /INVALID_TOKEN_CLIENT/,
  );
});

test('rejects missing sub', () => {
  assert.throws(
    () => validateCognitoClaims({ token_use: 'access', client_id: CLIENT }, [CLIENT]),
    /INVALID_TOKEN_SUB/,
  );
});
