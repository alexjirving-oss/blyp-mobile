import { callEconomyBackend } from './economyLiveApi';

export type BattleArenaSide = {
  userId: string;
  displayName: string;
  username: string;
  joined: boolean;
  joinedAt: number | null;
};

export type BattleArenaSnapshot = {
  battleId: string;
  roomId: string;
  state:
    | 'INVITED'
    | 'ACCEPTED'
    | 'LOBBY_OPEN'
    | 'COUNTDOWN'
    | 'LIVE'
    | 'FINALIZING'
    | 'ENDED'
    | 'DECLINED'
    | 'CANCELLED'
    | 'EXPIRED';
  title: string;
  scheduledStartAt: number;
  lobbyOpensAt: number;
  graceEndsAt: number;
  durationSec: number;
  depositMode: string;
  stakeCoins: number;
  sessionId: string | null;
  stageArn: string | null;
  countdownEndsAt: number | null;
  liveStartedAt: number | null;
  finalizingAt: number | null;
  endedAt: number | null;
  terminalReason: string | null;
  winnerSide: 'A' | 'B' | null;
  score: { A: number; B: number };
  sideA: BattleArenaSide;
  sideB: BattleArenaSide;
  settlement: any;
  version: number;
  updatedAt: number;
};

export type RegisterBattleArenaInput = {
  battleId: string;
  opponentUid: string;
  creatorName?: string;
  creatorUsername?: string;
  opponentName?: string;
  opponentUsername?: string;
  title?: string;
  scheduledStartAt: number;
  durationSec: number;
  depositMode: 'free' | 'staked';
  stakeCoins: number;
};

export async function registerBattleArena(
  input: RegisterBattleArenaInput,
): Promise<BattleArenaSnapshot> {
  const response = await callEconomyBackend<{ battle: BattleArenaSnapshot }>(
    '/api/battles/register',
    'POST',
    input,
  );
  return response.battle;
}

export async function getBattleArena(
  battleId: string,
): Promise<BattleArenaSnapshot> {
  const response = await callEconomyBackend<{ battle: BattleArenaSnapshot; serverNow: number }>(
    `/api/battles/${encodeURIComponent(battleId)}`,
    'GET',
  );
  return response.battle;
}

async function battleAction(
  battleId: string,
  action: 'accept' | 'decline' | 'cancel' | 'end',
): Promise<BattleArenaSnapshot> {
  const response = await callEconomyBackend<{ battle: BattleArenaSnapshot }>(
    `/api/battles/${encodeURIComponent(battleId)}/${action}`,
    'POST',
  );
  return response.battle;
}

export function acceptBattleArena(battleId: string) {
  return battleAction(battleId, 'accept');
}

export function declineBattleArena(battleId: string) {
  return battleAction(battleId, 'decline');
}

export function cancelBattleArena(battleId: string) {
  return battleAction(battleId, 'cancel');
}

export function endBattleArena(battleId: string) {
  return battleAction(battleId, 'end');
}

export async function voteBattleArena(
  battleId: string,
  side: 'A' | 'B',
): Promise<{ applied: boolean; battle: BattleArenaSnapshot }> {
  return callEconomyBackend(
    `/api/battles/${encodeURIComponent(battleId)}/vote`,
    'POST',
    { side },
  );
}
