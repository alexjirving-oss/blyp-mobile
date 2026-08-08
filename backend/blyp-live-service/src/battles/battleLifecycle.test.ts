import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BATTLE_COUNTDOWN_MS,
  BATTLE_JOIN_GRACE_MS,
  BATTLE_LOBBY_LEAD_MS,
  applyGiftScoreOnce,
  battleSideForUser,
  battleTokenAttributes,
  evaluateBattleLifecycle,
} from './battleLifecycle';

test('free scheduled battle authorizes publishers without escrow', () => {
  const freeBattle = {
    creatorUid: 'creator-sub',
    opponentUid: 'opponent-sub',
    depositMode: 'free',
    stakeCoins: 0,
  };

  assert.equal(battleSideForUser(freeBattle, 'creator-sub'), 'A');
  assert.equal(battleSideForUser(freeBattle, 'opponent-sub'), 'B');
  assert.equal(battleSideForUser(freeBattle, 'viewer-sub'), null);
});

test('battle token attributes pin A left and B right', () => {
  assert.deepEqual(battleTokenAttributes('A', 'battle-1', 'session-1'), {
    role: 'battle',
    battleId: 'battle-1',
    battleSide: 'A',
    slotIndex: '0',
    sessionId: 'session-1',
  });
  assert.equal(battleTokenAttributes('B', 'battle-1', 'session-1').slotIndex, '1');
});

test('accepted battle opens its lobby exactly at T-15', () => {
  const publishedAt = 2_000_000;
  const snapshot = {
    state: 'ACCEPTED' as const,
    scheduledStartAtMs: publishedAt,
    durationSec: 300,
    sideAJoined: false,
    sideBJoined: false,
  };

  assert.equal(evaluateBattleLifecycle(snapshot, publishedAt - BATTLE_LOBBY_LEAD_MS - 1), null);
  assert.deepEqual(
    evaluateBattleLifecycle(snapshot, publishedAt - BATTLE_LOBBY_LEAD_MS),
    { nextState: 'LOBBY_OPEN' },
  );
});

test('gift event contributes to one side exactly once', () => {
  const seen = new Set<string>();
  const first = applyGiftScoreOnce(
    { A: 0, B: 0 },
    seen,
    { giftEventId: 'gift-event-1', side: 'B', points: 25 },
  );
  const replay = applyGiftScoreOnce(
    first.score,
    seen,
    { giftEventId: 'gift-event-1', side: 'B', points: 25 },
  );

  assert.deepEqual(first, { applied: true, score: { A: 0, B: 25 } });
  assert.deepEqual(replay, { applied: false, score: { A: 0, B: 25 } });
});

test('one missing side receives the full two-minute grace before no-show', () => {
  const publishedAt = 1_000_000;
  const beforeGrace = evaluateBattleLifecycle(
    {
      state: 'LOBBY_OPEN',
      scheduledStartAtMs: publishedAt,
      durationSec: 300,
      sideAJoined: true,
      sideBJoined: false,
    },
    publishedAt + BATTLE_JOIN_GRACE_MS - 1,
  );
  const afterGrace = evaluateBattleLifecycle(
    {
      state: 'LOBBY_OPEN',
      scheduledStartAtMs: publishedAt,
      durationSec: 300,
      sideAJoined: true,
      sideBJoined: false,
    },
    publishedAt + BATTLE_JOIN_GRACE_MS,
  );

  assert.equal(beforeGrace, null);
  assert.deepEqual(afterGrace, {
    nextState: 'FINALIZING',
    terminalReason: 'NO_SHOW_B',
  });
});

test('both present move from lobby to countdown at published time', () => {
  const publishedAt = 1_000_000;
  const decision = evaluateBattleLifecycle(
    {
      state: 'LOBBY_OPEN',
      scheduledStartAtMs: publishedAt,
      durationSec: 300,
      sideAJoined: true,
      sideBJoined: true,
    },
    publishedAt,
  );

  assert.equal(decision?.nextState, 'COUNTDOWN');
  assert.ok((decision?.countdownEndsAtMs || 0) > publishedAt);
});

test('server countdown starts live and duration closes scoring', () => {
  const countdownEndsAt = 3_000_000 + BATTLE_COUNTDOWN_MS;
  const live = evaluateBattleLifecycle(
    {
      state: 'COUNTDOWN',
      scheduledStartAtMs: 3_000_000,
      durationSec: 60,
      sideAJoined: true,
      sideBJoined: true,
      countdownEndsAtMs: countdownEndsAt,
    },
    countdownEndsAt,
  );
  assert.deepEqual(live, { nextState: 'LIVE', liveStartedAtMs: countdownEndsAt });

  const finalizing = evaluateBattleLifecycle(
    {
      state: 'LIVE',
      scheduledStartAtMs: 3_000_000,
      durationSec: 60,
      sideAJoined: true,
      sideBJoined: true,
      liveStartedAtMs: countdownEndsAt,
    },
    countdownEndsAt + 60_000,
  );
  assert.deepEqual(finalizing, {
    nextState: 'FINALIZING',
    terminalReason: 'DURATION_COMPLETE',
  });
});
