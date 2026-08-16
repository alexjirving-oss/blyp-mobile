import { getEconomyInfra } from '../../economy/infra';
import { grid9RedisKeys } from './redisKeys';
import { Grid9Error } from './grid9Errors';
import type { Grid9MatchPhase, Grid9RoomMode } from './state';

const LISTABLE_PHASES = new Set<Grid9MatchPhase>([
  'lobby_waiting',
  'countdown',
  'roulette',
  'combat',
]);

export interface Grid9PublicMatchSummary {
  matchId: string;
  phase: Grid9MatchPhase;
  jackpotCoins: number;
  audienceCount: number;
  region: string;
  roomMode: 'public';
  survivors: number;
  updatedAt: string;
}

function redis() {
  return getEconomyInfra().redis;
}

/**
 * Public browse list: active public matches only.
 * Never returns private room codes, assignment tokens, escrow, or inventory.
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
        players?: Array<{ status?: string }>;
        updatedAt?: string;
      };
      if (state.roomMode !== 'public') continue;
      if (!state.phase || !LISTABLE_PHASES.has(state.phase)) continue;
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
