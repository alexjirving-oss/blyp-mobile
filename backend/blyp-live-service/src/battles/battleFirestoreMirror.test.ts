import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBattleFirestoreMirror } from './battleFirestoreMirror';

test('initial server mirror contains fields required for the client invite merge', () => {
  const mirror = buildBattleFirestoreMirror({
    battleId: 'btl_create_regression',
    roomId: 'battle:btl_create_regression',
    state: 'INVITED',
    title: 'Creator vs Opponent',
    scheduledStartAt: 2_000_000,
    durationSec: 300,
    depositMode: 'free',
    stakeCoins: 0,
    sessionId: null,
    stageArn: null,
    countdownEndsAt: null,
    liveStartedAt: null,
    endedAt: null,
    terminalReason: null,
    winnerSide: null,
    score: { A: 0, B: 0 },
    sideA: {
      userId: 'creator-sub',
      displayName: 'Creator',
      username: 'creator',
      joined: false,
    },
    sideB: {
      userId: 'opponent-sub',
      displayName: 'Opponent',
      username: 'opponent',
      joined: false,
    },
    settlement: {},
    version: 1,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
  });

  // registerBattleRecord mirrors before app 1.0.24 calls set(..., { merge: true }).
  // Firestore therefore evaluates an update, whose rule reads these existing fields.
  assert.equal(mirror.creatorUid, 'creator-sub');
  assert.equal(mirror.opponentUid, 'opponent-sub');
  assert.deepEqual(mirror.participantsUids, ['creator-sub', 'opponent-sub']);
  assert.ok(mirror.participantsUids.includes(mirror.creatorUid));
  assert.ok(mirror.participantsUids.includes(mirror.opponentUid));

  assert.equal(mirror.status, 'pending');
  assert.equal(mirror.scheduledStartAt, 2_000_000);
  assert.equal(mirror.createdAt, 1_000_000);
  assert.equal(mirror.updatedAt, 1_000_000);
});
