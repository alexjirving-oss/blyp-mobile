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
const STALE_LISTABLE_MS = 90 * 1000;
/** Hard abandon: no Redis progress for this long → leave the public index. */
const HARD_STALE_MS = 3 * 60 * 1000;

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
  players?: Array<{ kind?: string; status?: string; connectionState?: string }>;
  audienceCount?: number;
}): boolean {
  const now = Date.now();
  const deadlineMs = Date.parse(String(state.authority?.matchDeadlineAt || ''));
  if (Number.isFinite(deadlineMs) && deadlineMs > 0 && now > deadlineMs) {
    return true;
  }
  const updatedMs = Date.parse(String(state.updatedAt || ''));
  if (!Number.isFinite(updatedMs) || updatedMs <= 0) {
    // Missing heartbeat → treat as orphan once encountered.
    return true;
  }
  const age = now - updatedMs;
  if (age < STALE_LISTABLE_MS) return false;

  const humansAlive = Array.isArray(state.players)
    ? state.players.filter(
        (player) => player.kind === 'human' && player.status === 'alive',
      ).length
    : 0;
  const humansConnected = Array.isArray(state.players)
    ? state.players.filter(
        (player) =>
          player.kind === 'human' &&
          player.status === 'alive' &&
          player.connectionState === 'connected',
      ).length
    : 0;
  const audience = Math.max(0, Number(state.audienceCount || 0));

  // Sentinel-only combat/roulette with nobody watching = zombie.
  if (
    (state.phase === 'combat' || state.phase === 'roulette') &&
    humansAlive === 0 &&
    audience === 0
  ) {
    return true;
  }
  // Humans marked alive but none connected + no audience + stale = abandoned.
  if (
    (state.phase === 'combat' || state.phase === 'roulette') &&
    humansConnected === 0 &&
    audience === 0 &&
    age >= STALE_LISTABLE_MS
  ) {
    return true;
  }
  if (age >= HARD_STALE_MS) return true;
  return false;
}

async function dropFromActiveIndex(matchId: string): Promise<void> {
  await redis().srem(grid9RedisKeys.activeMatches(), matchId);
}

/**
 * Public browse list: active public matches only.
 * Ended / stale / deadline-expired matches are removed from the active index
 * on every list read (not a one-shot clear).
 */
export async function listPublicActiveGrid9Matches(
  limit = 40,
): Promise<Grid9PublicMatchSummary[]> {
  const capped = Math.max(1, Math.min(80, Math.floor(limit) || 40));
  const matchIds = await redis().smembers(grid9RedisKeys.activeMatches());
  if (matchIds.length === 0) return [];

  const summaries: Grid9PublicMatchSummary[] = [];
  for (const matchId of matchIds) {
    try {
      const stateJson = await redis().hget(
        grid9RedisKeys.matchAggregate(matchId),
        'state',
      );
      if (!stateJson) {
        await dropFromActiveIndex(matchId);
        continue;
      }
      const state = JSON.parse(stateJson) as {
        matchId?: string;
        roomMode?: Grid9RoomMode;
        phase?: Grid9MatchPhase;
        region?: string;
        audienceCount?: number;
        jackpot?: { currentCoins?: number };
        players?: Array<{
          kind?: string;
          status?: string;
          connectionState?: string;
        }>;
        entryFeeCoins?: number;
        updatedAt?: string;
        authority?: { matchDeadlineAt?: string };
      };
      if (!state.phase || !LISTABLE_PHASES.has(state.phase)) {
        // completed / cancelled / settling → leave the discoverability set forever.
        await dropFromActiveIndex(matchId);
        continue;
      }
      if (isStaleOrExpired(state)) {
        await dropFromActiveIndex(matchId);
        continue;
      }
      if (state.roomMode !== 'public') continue;
      if (summaries.length >= capped) continue;
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

/**
 * Startup / repair sweep: walk the entire active set and SREM anything
 * non-listable or stale. Returns how many IDs were dropped.
 */
export async function sweepGrid9ActiveMatchIndex(): Promise<{
  scanned: number;
  dropped: number;
}> {
  const matchIds = await redis().smembers(grid9RedisKeys.activeMatches());
  let dropped = 0;
  for (const matchId of matchIds) {
    try {
      const stateJson = await redis().hget(
        grid9RedisKeys.matchAggregate(matchId),
        'state',
      );
      if (!stateJson) {
        await dropFromActiveIndex(matchId);
        dropped += 1;
        continue;
      }
      const state = JSON.parse(stateJson) as {
        phase?: Grid9MatchPhase;
        roomMode?: Grid9RoomMode;
        updatedAt?: string;
        audienceCount?: number;
        players?: Array<{
          kind?: string;
          status?: string;
          connectionState?: string;
        }>;
        authority?: { matchDeadlineAt?: string };
      };
      if (!state.phase || !LISTABLE_PHASES.has(state.phase) || isStaleOrExpired(state)) {
        await dropFromActiveIndex(matchId);
        dropped += 1;
      }
    } catch {
      await dropFromActiveIndex(matchId);
      dropped += 1;
    }
  }
  return { scanned: matchIds.length, dropped };
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
  HARD_STALE_MS,
  LISTABLE_PHASES,
  isStaleOrExpired,
};
