import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  enqueueJoin,
  isCooldownClear,
  isDropProtected,
  listThrowableOccupants,
  listJumpKickTargets,
  markSurvivedWheelLand,
  markWheelHit,
  pickAutoDropTarget,
  recordDrop,
  emptySeatRoster,
  ensureSeatMeta,
  consumeExtraLife,
  QueueEntry,
} from './frenemiesSeatQueue';

describe('frenemies seat/queue rules', () => {
  it('protects first-spin until wheel land survived', () => {
    const roster = emptySeatRoster();
    ensureSeatMeta(roster, 'u1', 'A', 1);
    assert.equal(isDropProtected(roster, 'u1'), true);
    markWheelHit(roster, 'u1');
    assert.equal(isDropProtected(roster, 'u1'), false);
  });

  it('clears first-spin for all on-stage guests after a land', () => {
    const roster = emptySeatRoster();
    ensureSeatMeta(roster, 'a', 'A', 1);
    ensureSeatMeta(roster, 'b', 'B', 1);
    ensureSeatMeta(roster, 'c', 'C', 1);
    markSurvivedWheelLand(roster, ['a', 'b', 'c']);
    assert.equal(isDropProtected(roster, 'a'), false);
    assert.equal(isDropProtected(roster, 'b'), false);
    assert.equal(isDropProtected(roster, 'c'), false);
  });

  it('lists throwable peers after land (not self/host/protected)', () => {
    const roster = emptySeatRoster();
    ensureSeatMeta(roster, 'chooser', 'Chooser', 1);
    ensureSeatMeta(roster, 'peer', 'Peer', 1);
    ensureSeatMeta(roster, 'newbie', 'Newbie', 2);
    ensureSeatMeta(roster, 'host', 'Host', 1);
    markSurvivedWheelLand(roster, ['chooser', 'peer', 'host']);
    // newbie joined after land — still protected
    const occ = [
      { userId: 'chooser', displayName: 'Chooser', slotIndex: 1 },
      { userId: 'peer', displayName: 'Peer', slotIndex: 2 },
      { userId: 'newbie', displayName: 'Newbie', slotIndex: 3 },
      { userId: 'host', displayName: 'Host', slotIndex: 4 },
    ];
    const throwable = listThrowableOccupants(occ, roster, {
      chooserUserId: 'chooser',
      hostUserId: 'host',
    });
    assert.deepEqual(
      throwable.map((t) => t.userId),
      ['peer'],
    );
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

  it('consumes extra life once and excludes life holders from jump targets', () => {
    const roster = emptySeatRoster();
    ensureSeatMeta(roster, 'life', 'L', 1);
    markWheelHit(roster, 'life');
    roster.life.extraLives = 1;
    ensureSeatMeta(roster, 'plain', 'P', 1);
    markWheelHit(roster, 'plain');
    assert.equal(consumeExtraLife(roster, 'life'), true);
    assert.equal(roster.life.extraLives, 0);
    assert.equal(consumeExtraLife(roster, 'life'), false);
    roster.life.extraLives = 1;
    const targets = listJumpKickTargets(
      [
        { userId: 'life', displayName: 'L', slotIndex: 1 },
        { userId: 'plain', displayName: 'P', slotIndex: 2 },
      ],
      roster,
      { hostUserId: 'host' },
    );
    assert.deepEqual(
      targets.map((t) => t.userId),
      ['plain'],
    );
  });

  it('queue is FIFO and deduped', () => {
    let q: QueueEntry[] = [];
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
