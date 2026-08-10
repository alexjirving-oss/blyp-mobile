import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  enqueueJoin,
  isCooldownClear,
  isDropProtected,
  markWheelHit,
  pickAutoDropTarget,
  recordDrop,
  emptySeatRoster,
  ensureSeatMeta,
} from './frenemiesSeatQueue';

describe('frenemies seat/queue rules', () => {
  it('protects first-spin until wheel hit', () => {
    const roster = emptySeatRoster();
    ensureSeatMeta(roster, 'u1', 'A', 1);
    assert.equal(isDropProtected(roster, 'u1'), true);
    markWheelHit(roster, 'u1');
    assert.equal(isDropProtected(roster, 'u1'), false);
  });

  it('enforces just-dropped cooldown for one full round', () => {
    const roster = emptySeatRoster();
    ensureSeatMeta(roster, 'u1', 'A', 3);
    markWheelHit(roster, 'u1');
    recordDrop(roster, 'u1', 'A', 5);
    assert.equal(isCooldownClear(roster.u1, 5), false);
    assert.equal(isCooldownClear(roster.u1, 6), true);
    assert.equal(roster.u1.hasHadWheelHit, false);
  });

  it('auto-drop picks longest-seated unprotected only', () => {
    const roster = emptySeatRoster();
    ensureSeatMeta(roster, 'new', 'N', 4);
    ensureSeatMeta(roster, 'old', 'O', 1);
    markWheelHit(roster, 'old');
    ensureSeatMeta(roster, 'mid', 'M', 2);
    markWheelHit(roster, 'mid');
    const pick = pickAutoDropTarget(
      [
        { userId: 'new', displayName: 'N', slotIndex: 1 },
        { userId: 'mid', displayName: 'M', slotIndex: 2 },
        { userId: 'old', displayName: 'O', slotIndex: 3 },
      ],
      roster,
    );
    assert.equal(pick?.userId, 'old');
  });

  it('queue is FIFO and deduped', () => {
    let q = [];
    let r = enqueueJoin(q, {
      userId: 'a',
      displayName: 'A',
      requestedAt: 't1',
      source: 'comment',
    });
    assert.equal(r.enqueued, true);
    q = r.queue;
    r = enqueueJoin(q, {
      userId: 'b',
      displayName: 'B',
      requestedAt: 't2',
      source: 'cta',
    });
    q = r.queue;
    r = enqueueJoin(q, {
      userId: 'a',
      displayName: 'A2',
      requestedAt: 't3',
      source: 'guest_request',
    });
    assert.equal(r.enqueued, false);
    assert.equal(r.reason, 'ALREADY_QUEUED');
    assert.deepEqual(
      r.queue.map((x) => x.userId),
      ['a', 'b'],
    );
  });
});
