import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __grid9MatchDirectoryTest } from './grid9MatchDirectory';

describe('grid9MatchDirectory stale filter', () => {
  const { isStaleOrExpired, STALE_LISTABLE_MS } = __grid9MatchDirectoryTest;

  it('keeps fresh combat with humans', () => {
    assert.equal(
      isStaleOrExpired({
        phase: 'combat',
        updatedAt: new Date().toISOString(),
        audienceCount: 0,
        players: [{ kind: 'human', status: 'alive' }],
        authority: { matchDeadlineAt: new Date(Date.now() + 60_000).toISOString() },
      }),
      false,
    );
  });

  it('drops past match deadline', () => {
    assert.equal(
      isStaleOrExpired({
        phase: 'combat',
        updatedAt: new Date().toISOString(),
        audienceCount: 0,
        players: [{ kind: 'human', status: 'alive' }],
        authority: { matchDeadlineAt: new Date(Date.now() - 1_000).toISOString() },
      }),
      true,
    );
  });

  it('drops stale sentinel-only combat with audience 0', () => {
    assert.equal(
      isStaleOrExpired({
        phase: 'combat',
        updatedAt: new Date(Date.now() - STALE_LISTABLE_MS - 1_000).toISOString(),
        audienceCount: 0,
        players: [{ kind: 'sentinel', status: 'alive' }],
        authority: { matchDeadlineAt: new Date(Date.now() + 60_000).toISOString() },
      }),
      true,
    );
  });
});
