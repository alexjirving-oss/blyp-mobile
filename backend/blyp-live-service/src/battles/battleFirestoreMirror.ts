import type { BattleLifecycleState, BattleSide, BattleTerminalReason } from './battleLifecycle';

export type BattleFirestoreMirrorInput = {
  battleId: string;
  roomId: string;
  state: BattleLifecycleState;
  title: string;
  scheduledStartAt: number;
  durationSec: number;
  depositMode: string;
  stakeCoins: number;
  sessionId: string | null;
  stageArn: string | null;
  countdownEndsAt: number | null;
  liveStartedAt: number | null;
  endedAt: number | null;
  terminalReason: BattleTerminalReason | null;
  winnerSide: BattleSide | null;
  score: { A: number; B: number };
  sideA: {
    userId: string;
    displayName: string;
    username: string;
    joined: boolean;
  };
  sideB: {
    userId: string;
    displayName: string;
    username: string;
    joined: boolean;
  };
  settlement: any;
  version: number;
  createdAt: number;
  updatedAt: number;
};

function legacyStatus(state: BattleLifecycleState): string {
  if (state === 'INVITED') return 'pending';
  if (state === 'ACCEPTED' || state === 'LOBBY_OPEN' || state === 'COUNTDOWN') return 'scheduled';
  if (state === 'LIVE' || state === 'FINALIZING') return 'live';
  if (state === 'ENDED') return 'completed';
  if (state === 'DECLINED') return 'rejected';
  if (state === 'CANCELLED') return 'cancelled';
  return 'expired';
}

/**
 * Build the complete Firestore presentation row before the mobile client merges
 * its optional fields. A partial Admin SDK create turns the client's following
 * set(..., { merge: true }) into an update, so the participant identity fields
 * required by Firestore update rules must already exist.
 */
export function buildBattleFirestoreMirror(arena: BattleFirestoreMirrorInput) {
  const creatorUid = arena.sideA.userId;
  const opponentUid = arena.sideB.userId;
  return {
    creatorUid,
    creatorName: arena.sideA.displayName,
    creatorUsername: arena.sideA.username,
    opponentUid,
    opponentName: arena.sideB.displayName,
    opponentUsername: arena.sideB.username,
    participantsUids: [creatorUid, opponentUid],
    status: legacyStatus(arena.state),
    title: arena.title,
    scheduledStartAt: arena.scheduledStartAt,
    durationSec: arena.durationSec,
    depositMode: arena.depositMode,
    stakeCoins: arena.stakeCoins,
    serverState: arena.state,
    serverVersion: arena.version,
    roomId: arena.roomId,
    liveStreamId: arena.sessionId,
    stageArn: arena.stageArn,
    creatorJoined: arena.sideA.joined,
    opponentJoined: arena.sideB.joined,
    countdownEndsAt: arena.countdownEndsAt,
    liveStartedAt: arena.liveStartedAt,
    endedAt: arena.endedAt,
    terminalReason: arena.terminalReason,
    winnerSide: arena.winnerSide,
    winnerUid:
      arena.winnerSide === 'A'
        ? creatorUid
        : arena.winnerSide === 'B'
          ? opponentUid
          : null,
    score: { creator: arena.score.A, opponent: arena.score.B },
    settlement: arena.settlement || null,
    createdAt: arena.createdAt,
    updatedAt: arena.updatedAt,
  };
}
