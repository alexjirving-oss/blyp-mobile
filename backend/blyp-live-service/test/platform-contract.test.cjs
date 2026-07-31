const test = require('node:test');
const assert = require('node:assert/strict');

const {
  registeredEventTypes,
  validateEventPayload,
  validateEventVersion,
} = require('../dist/platform/events/eventRegistry');
const {
  decodeCursor,
  encodeCursor,
  parsePageSize,
} = require('../dist/platform/pagination');

test('event registry accepts the declared identity-linked v1 payload', () => {
  const payload = {
    provider: 'firebase',
    legacyUserId: 'firebase-user-1',
    canonicalUserId: 'cognito-sub-1',
    verificationMethod: 'firebase_id_token',
  };

  assert.deepEqual(validateEventPayload('identity.linked.v1', payload), payload);
  assert.doesNotThrow(() => validateEventVersion('identity.linked.v1', 1));
  assert.ok(registeredEventTypes().includes('identity.linked.v1'));
});

test('event registry rejects unregistered types and structurally invalid payloads', () => {
  assert.throws(
    () => validateEventPayload('identity.linked.v2', {}),
    (error) => error.code === 'EVENT_TYPE_UNREGISTERED'
  );
  assert.throws(
    () => validateEventPayload('identity.linked.v1', { provider: 'firebase' }),
    (error) => error.code === 'EVENT_PAYLOAD_INVALID'
  );
  assert.throws(
    () => validateEventVersion('identity.linked.v1', 2),
    (error) => error.code === 'EVENT_VERSION_MISMATCH'
  );
});

test('pagination cursors round-trip without exposing database offsets', () => {
  const payload = { sortValue: '2026-07-31T11:15:00.000Z', id: 'record-42' };
  const cursor = encodeCursor(payload);

  assert.equal(cursor.includes('record-42'), false);
  assert.deepEqual(decodeCursor(cursor), payload);
  assert.equal(decodeCursor(null), null);
});

test('pagination rejects malformed cursors and out-of-bounds page sizes', () => {
  assert.throws(() => decodeCursor('not-a-json-cursor'), (error) => error.code === 'INVALID_CURSOR');
  assert.equal(parsePageSize(undefined), 25);
  assert.equal(parsePageSize('100'), 100);
  assert.throws(() => parsePageSize('0'), (error) => error.code === 'INVALID_PAGE_SIZE');
  assert.throws(() => parsePageSize('101'), (error) => error.code === 'INVALID_PAGE_SIZE');
});
