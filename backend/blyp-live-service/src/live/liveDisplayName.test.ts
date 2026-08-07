import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safeLiveDisplayName } from './liveDisplayName';

describe('safeLiveDisplayName', () => {
  const uid = '96b24294-6051-70bb-3f4c-a40185e033cf';

  it('preserves a public username or display name', () => {
    assert.equal(safeLiveDisplayName('@alex.blyp', uid), 'alex.blyp');
    assert.equal(safeLiveDisplayName('Alex Blyp', uid), 'Alex Blyp');
  });

  it('never exposes Cognito ids as live labels', () => {
    assert.equal(safeLiveDisplayName(uid, uid), 'Viewer');
    assert.equal(safeLiveDisplayName('11111111-2222-3333-4444-555555555555', uid), 'Viewer');
    assert.equal(safeLiveDisplayName('user_01ABCDEF23456789', uid), 'Viewer');
    assert.equal(safeLiveDisplayName('A1bcDefGhijkLmnoPqrstUvwxYz1', uid), 'Viewer');
  });
});
