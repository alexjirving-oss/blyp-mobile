import { getEconomyInfra } from '../../economy/infra';
import { grid9RedisKeys } from './redisKeys';
import { Grid9Error } from './grid9Errors';
import type { Grid9MatchPhase, Grid9RoomMode } from './state';

/** Active browse phases only — never completed / cancelled / settling. */
const LISTABLE_PHASES = new Set<Grid9MatchPhase>([
  'lobby_waiting',
  'private_lobby',
  'countdown',
  'roulette',
  'combat',
]);

/** Drop listable-but-abandoned matches so Live Grid cannot fill with zombies. */
const STALE_LISTABLE_MS = 3 * 60 * 1000;

export interface Grid9PublicMatchSummary {
  matchId: string;
  phase: Grid9MatchPhase;
  jackpotCoins: number;
  audienceCount: number;
  region: string;
  roomMode: 'public';
  survivors: number;
  entryFeeCoins: number;
  updatedAt: string;
}

function redis() {
  return getEconomyInfra().redis;
}

function isStaleOrExpired(state: {
  phase?: Grid9MatchPhase;
  updatedAt?: string;
  authority?: { matchDeadlineAt?: string };
  players?: Array<{ kind?: string; status?: string }>;
  audienceCount?: number;
}): boolean {
  const now = Date.now();
  const deadlineMs = Date.parse(String(state.authority?.matchDeadlineAt || ''));
  if (Number.isFinite(deadlineMs) && deadlineMs > 0 && now > deadlineMs) {
    return true;
  }
  const updatedMs = Date.parse(String(state.updatedAt || ''));
  if (!Number.isFinite(updatedMs) || updatedMs <= 0) return false;
  if (now - updatedMs < STALE_LISTABLE_MS) return false;

  // Combat/roulette with no connected humans and zero audience = orphaned zombie.
  const humansAlive = Array.isArray(state.players)
    ? state.players.filter(
        (player) => player.kind === 'human' && player.status === 'alive',
      ).length
    : 0;
  const audience = Math.max(0, Number(state.audienceCount || 0));
  if (
    (state.phase === 'combat' || state.phase === 'roulette') &&
    humansAlive === 0 &&
    audience === 0
  ) {
    return true;
  }
  // Any listable phase with no progress for too long.
  if (now - updatedMs > STALE_LISTABLE_MS * 2) {
    return true;
  }
  return false;
}

/**
 * Public browse list: active public matches only.
 * Never returns private room codes, assignment tokens, escrow, or inventory.
 * Ended / stale / deadline-expired matches are removed from the active index.
 */
export async function listPublicActiveGrid9Matches(
  limit = 40,
): Promise<Grid9PublicMatchSummary[]> {
  const capped = Math.max(1, Math.min(80, Math.floor(limit) || 40));
  const matchIds = await redis().smembers(grid9RedisKeys.activeMatches());
  if (matchIds.length === 0) return [];

  const summaries: Grid9PublicMatchSummary[] = [];
  for (const matchId of matchIds) {
    if (summaries.length >= capped) break;
    try {
      const stateJson = await redis().hget(
        grid9RedisKeys.matchAggregate(matchId),
        'state',
      );
      if (!stateJson) {
        await redis().srem(grid9RedisKeys.activeMatches(), matchId);
        continue;
      }
      const state = JSON.parse(stateJson) as {
        matchId?: string;
        roomMode?: Grid9RoomMode;
        phase?: Grid9MatchPhase;
        region?: string;
        audienceCount?: number;
        jackpot?: { currentCoins?: number };
        players?: Array<{ kind?: string; status?: string }>;
        entryFeeCoins?: number;
        updatedAt?: string;
        authority?: { matchDeadlineAt?: string };
      };
      if (!state.phase || !LISTABLE_PHASES.has(state.phase)) {
        await redis().srem(grid9RedisKeys.activeMatches(), matchId);
        continue;
      }
      if (isStaleOrExpired(state)) {
        await redis().srem(grid9RedisKeys.activeMatches(), matchId);
        continue;
      }
      if (state.roomMode !== 'public') continue;
      const survivors = Array.isArray(state.players)
        ? state.players.filter((player) => player.status === 'alive').length
        : 0;
      summaries.push({
        matchId: String(state.matchId || matchId),
        phase: state.phase,
        jackpotCoins: Math.max(0, Number(state.jackpot?.currentCoins || 0)),
        audienceCount: Math.max(0, Number(state.audienceCount || 0)),
        region: String(state.region || 'eu-west-2'),
        roomMode: 'public',
        survivors,
        entryFeeCoins: Math.max(0, Number(state.entryFeeCoins || 0)),
        updatedAt: String(state.updatedAt || new Date().toISOString()),
      });
    } catch {
      // Skip malformed aggregates; do not fail the whole list.
    }
  }

  summaries.sort((a, b) => {
    if (b.jackpotCoins !== a.jackpotCoins) return b.jackpotCoins - a.jackpotCoins;
    return b.audienceCount - a.audienceCount;
  });
  return summaries;
}

export async function getPublicGrid9MatchSummary(
  matchId: string,
): Promise<Grid9PublicMatchSummary> {
  const list = await listPublicActiveGrid9Matches(80);
  const found = list.find((item) => item.matchId === matchId);
  if (!found) {
    throw new Grid9Error('MATCH_NOT_FOUND', 'Public Grid 9 match not found');
  }
  return found;
}

/** Exported for unit tests. */
export const __grid9MatchDirectoryTest = {
  STALE_LISTABLE_MS,
  isStaleOrExpired,
};
