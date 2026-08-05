/**
 * Global rankings (Phase 0 + Phase 1 + P1.5).
 *
 * All-time boards read denormalized wallet / Firestore counters.
 * Windowed day/week/month/year boards prefer durable rankings_snapshots
 * (cron-materialized), falling back to query-time ledger aggregates with
 * Redis TTL cache and best-effort snapshot writes.
 */

import { getEconomyInfra } from './infra';
import { EconomyError } from './economyErrors';
import { getFirestore } from '../admin/firestoreAdmin';
import { logger } from '../config/logger';

export type RankingBoardId = 'coin_spend' | 'gem_earn' | 'followers_total';

export type RankingWindow = 'day' | 'week' | 'month' | 'year' | 'alltime';

export type RankingEntry = {
  rank: number;
  userId: string;
  displayName: string;
  photoURL: string;
  handle: string;
  score: number;
};

export type RankingBoardResponse = {
  board: RankingBoardId;
  window: RankingWindow;
  metric: string;
  unit: string;
  entries: RankingEntry[];
  computedAt: string;
  /** How the board was produced (for clients / ops). */
  source: 'wallets' | 'ledger_window' | 'firestore' | 'cache' | 'snapshot';
  cacheTtlSec?: number;
};

export type RankingMaterializeResult = {
  board: RankingBoardId;
  window: Exclude<RankingWindow, 'alltime'>;
  entryCount: number;
  computedAt: string;
  ok: boolean;
  error?: string;
};

const WINDOWS: RankingWindow[] = ['day', 'week', 'month', 'year', 'alltime'];

const WINDOWED: Array<Exclude<RankingWindow, 'alltime'>> = ['day', 'week', 'month', 'year'];

const ECONOMY_BOARDS: Array<'coin_spend' | 'gem_earn'> = ['coin_spend', 'gem_earn'];

/** Snapshot rollup depth (cron + durable reads). */
export const RANKINGS_SNAPSHOT_LIMIT = 50;

const BOARD_META: Record<
  RankingBoardId,
  { metric: string; unit: string; walletColumn?: 'lifetime_spend_coins' | 'lifetime_earned_gems' }
> = {
  coin_spend: {
    metric: 'lifetime_spend_coins',
    unit: 'coins',
    walletColumn: 'lifetime_spend_coins',
  },
  gem_earn: {
    metric: 'lifetime_earned_gems',
    unit: 'gems',
    walletColumn: 'lifetime_earned_gems',
  },
  followers_total: {
    metric: 'followersCount',
    unit: 'followers',
  },
};

/** Ledger types that count toward coin spend (amounts are typically negative). */
const COIN_SPEND_TYPES = [
  'GIFT_SPEND',
  'PROMOTE_SPEND',
  'LIVE_GAME_ENTRY',
  'BATTLE_DEPOSIT',
  'MATCHDAY_UNLOCK',
  'MATCHDAY_PREDICTION_STAKE',
] as const;

/** Ledger types that count toward gem earn (amounts are positive). */
const GEM_EARN_TYPES = ['GIFT_EARN', 'TEAM_BONUS_EARN', 'TEAM_LEADER_BONUS'] as const;

const WINDOW_INTERVAL: Record<Exclude<RankingWindow, 'alltime'>, string> = {
  day: '1 day',
  week: '7 days',
  month: '30 days',
  year: '365 days',
};

const CACHE_TTL_SEC: Record<RankingWindow, number> = {
  day: 60,
  week: 120,
  month: 300,
  year: 600,
  alltime: 60,
};

/** Prefer snapshot reads when cron has refreshed within this age. */
const SNAPSHOT_MAX_AGE_MS: Record<Exclude<RankingWindow, 'alltime'>, number> = {
  day: 5 * 60 * 1000,
  week: 15 * 60 * 1000,
  month: 30 * 60 * 1000,
  year: 60 * 60 * 1000,
};

function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 25;
  return Math.max(1, Math.min(50, Math.floor(n)));
}

function parseWindow(raw: unknown): RankingWindow {
  const w = String(raw || 'alltime').trim().toLowerCase() as RankingWindow;
  if ((WINDOWS as string[]).includes(w)) return w;
  throw new EconomyError('INVALID_INPUT', 400, 'Unknown rankings window', {
    window: raw,
    allowed: WINDOWS,
  });
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function cacheKey(board: RankingBoardId, window: RankingWindow, limit: number): string {
  return `rankings:v1:${board}:${window}:${limit}`;
}

async function cacheGet(key: string): Promise<RankingBoardResponse | null> {
  try {
    const { redis } = getEconomyInfra();
    const raw = await redis.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RankingBoardResponse;
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    return { ...parsed, source: 'cache' };
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: RankingBoardResponse, ttlSec: number): Promise<void> {
  try {
    const { redis } = getEconomyInfra();
    await redis.set(key, JSON.stringify(value), 'EX', Math.max(15, ttlSec));
  } catch {
    // Cache is best-effort.
  }
}

async function cacheInvalidateBoard(board: RankingBoardId, window: RankingWindow): Promise<void> {
  try {
    const { redis } = getEconomyInfra();
    // Common client limits; keys are small so fan-out is fine.
    const keys = [10, 25, 50].map((n) => cacheKey(board, window, n));
    if (keys.length) await redis.del(...keys);
  } catch {
    // Cache is best-effort.
  }
}

async function ensureRankingsSnapshotsTable(): Promise<void> {
  const { db } = getEconomyInfra();
  // Idempotent; quotes reserved "window" column.
  await db.raw(`
    CREATE TABLE IF NOT EXISTS rankings_snapshots (
      board text NOT NULL,
      "window" text NOT NULL,
      user_id text NOT NULL,
      rank integer NOT NULL,
      score bigint NOT NULL DEFAULT 0,
      display_name text NOT NULL DEFAULT '',
      photo_url text NOT NULL DEFAULT '',
      handle text NOT NULL DEFAULT '',
      computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (board, "window", user_id)
    )
  `);
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_rankings_snapshots_board_window_rank ON rankings_snapshots (board, "window", rank)`,
  );
}

async function persistSnapshot(
  board: RankingBoardId,
  window: RankingWindow,
  entries: RankingEntry[],
  opts?: { throwOnError?: boolean },
): Promise<void> {
  try {
    const { db } = getEconomyInfra();
    const computedAt = new Date();
    await db.transaction(async (trx) => {
      await trx('rankings_snapshots').where({ board, window }).del();
      if (entries.length === 0) return;
      await trx('rankings_snapshots').insert(
        entries.map((e) => ({
          board,
          window,
          user_id: e.userId,
          rank: e.rank,
          score: Math.floor(e.score),
          display_name: e.displayName || '',
          photo_url: e.photoURL || '',
          handle: e.handle || '',
          computed_at: computedAt,
        })),
      );
    });
  } catch (e: any) {
    logger.warn(
      { err: e?.message || String(e), board, window },
      '[rankings] snapshot persist failed',
    );
    if (opts?.throwOnError) throw e;
  }
}

async function enrichProfiles(
  userIds: string[],
): Promise<Map<string, { displayName: string; photoURL: string; handle: string; optOut: boolean }>> {
  const out = new Map<
    string,
    { displayName: string; photoURL: string; handle: string; optOut: boolean }
  >();
  const fs = getFirestore();
  if (!fs || userIds.length === 0) return out;

  const refs = userIds.map((id) => fs.collection('users').doc(id));
  try {
    const snaps = await fs.getAll(...refs);
    for (const snap of snaps) {
      const data = (snap.data() || {}) as Record<string, unknown>;
      const displayName =
        str(data.displayName) || str(data.username) || str(data.handle) || 'Blyp user';
      const handle = str(data.username) || str(data.handle) || '';
      const photoURL =
        str(data.photoURL) || str(data.avatar) || str(data.profilePicture) || '';
      const optOut = data.leaderboardOptOut === true || data.privacyHideFromRankings === true;
      out.set(snap.id, { displayName, photoURL, handle, optOut });
    }
  } catch {
    // Enrichment is best-effort; rankings still return userIds + scores.
  }
  return out;
}

function toEntries(
  rows: Array<{ user_id: string; score: number }>,
  profiles: Map<string, { displayName: string; photoURL: string; handle: string; optOut: boolean }>,
  limit: number,
): RankingEntry[] {
  const entries: RankingEntry[] = [];
  for (const r of rows) {
    const userId = String(r.user_id || '');
    if (!userId) continue;
    const profile = profiles.get(userId);
    if (profile?.optOut) continue;
    const score = Number(r.score || 0);
    if (!Number.isFinite(score) || score <= 0) continue;
    entries.push({
      rank: 0,
      userId,
      score,
      displayName: profile?.displayName || 'Blyp user',
      photoURL: profile?.photoURL || '',
      handle: profile?.handle || '',
    });
    if (entries.length >= limit) break;
  }
  entries.forEach((e, i) => {
    e.rank = i + 1;
  });
  return entries;
}

async function walletBoard(
  board: 'coin_spend' | 'gem_earn',
  limit: number,
): Promise<RankingBoardResponse> {
  const meta = BOARD_META[board];
  const column = meta.walletColumn!;
  const { db } = getEconomyInfra();

  const rows = await db('wallets')
    .select('user_id', column)
    .where(column, '>', 0)
    .orderBy(column, 'desc')
    .limit(limit * 2);

  const ids = rows.map((r: any) => String(r.user_id || '')).filter(Boolean);
  const profiles = await enrichProfiles(ids);
  const entries = toEntries(
    rows.map((r: any) => ({ user_id: String(r.user_id || ''), score: Number(r[column] || 0) })),
    profiles,
    limit,
  );

  return {
    board,
    window: 'alltime',
    metric: meta.metric,
    unit: meta.unit,
    entries,
    computedAt: new Date().toISOString(),
    source: 'wallets',
  };
}

async function aggregateLedgerWindow(
  board: 'coin_spend' | 'gem_earn',
  window: Exclude<RankingWindow, 'alltime'>,
  limit: number,
): Promise<RankingEntry[]> {
  const { db } = getEconomyInfra();
  const interval = WINDOW_INTERVAL[window];
  const types = board === 'coin_spend' ? [...COIN_SPEND_TYPES] : [...GEM_EARN_TYPES];

  // Spend amounts are stored as negatives; earn as positives. Always rank by magnitude.
  const scoreExpr =
    board === 'coin_spend'
      ? db.raw('SUM(ABS(amount))::bigint AS score')
      : db.raw('SUM(amount)::bigint AS score');

  const rows = await db('ledger_entries')
    .select('user_id')
    .select(scoreExpr)
    .whereIn('entry_type', types)
    .whereIn('status', ['POSTED', 'PENDING'])
    .where('created_at', '>=', db.raw(`NOW() - INTERVAL '${interval}'`))
    .groupBy('user_id')
    .havingRaw('SUM(ABS(amount)) > 0')
    .orderBy('score', 'desc')
    .limit(limit * 2);

  const ids = rows.map((r: any) => String(r.user_id || '')).filter(Boolean);
  const profiles = await enrichProfiles(ids);
  return toEntries(
    rows.map((r: any) => ({ user_id: String(r.user_id || ''), score: Number(r.score || 0) })),
    profiles,
    limit,
  );
}

async function ledgerWindowBoard(
  board: 'coin_spend' | 'gem_earn',
  window: Exclude<RankingWindow, 'alltime'>,
  limit: number,
): Promise<RankingBoardResponse> {
  const meta = BOARD_META[board];
  const entries = await aggregateLedgerWindow(board, window, limit);

  const out: RankingBoardResponse = {
    board,
    window,
    metric: `${board}_${window}`,
    unit: meta.unit,
    entries,
    computedAt: new Date().toISOString(),
    source: 'ledger_window',
    cacheTtlSec: CACHE_TTL_SEC[window],
  };

  // Durable rollup for ops / cron consumers (best-effort on query path).
  void persistSnapshot(board, window, entries);

  return out;
}

async function readSnapshotBoard(
  board: 'coin_spend' | 'gem_earn',
  window: Exclude<RankingWindow, 'alltime'>,
  limit: number,
): Promise<RankingBoardResponse | null> {
  try {
    const { db } = getEconomyInfra();
    const rows = await db('rankings_snapshots')
      .select(
        'user_id',
        'rank',
        'score',
        'display_name',
        'photo_url',
        'handle',
        'computed_at',
      )
      .where({ board, window })
      .orderBy('rank', 'asc')
      .limit(limit);

    if (!rows.length) return null;

    const computedAtRaw = (rows[0] as any).computed_at;
    const computedAt = computedAtRaw ? new Date(computedAtRaw) : null;
    if (!computedAt || Number.isNaN(computedAt.getTime())) return null;
    const ageMs = Date.now() - computedAt.getTime();
    if (ageMs > SNAPSHOT_MAX_AGE_MS[window]) return null;

    const meta = BOARD_META[board];
    const entries: RankingEntry[] = rows.map((r: any, i: number) => ({
      rank: Number(r.rank) || i + 1,
      userId: String(r.user_id || ''),
      score: Number(r.score || 0),
      displayName: str(r.display_name) || 'Blyp user',
      photoURL: str(r.photo_url),
      handle: str(r.handle),
    }));

    return {
      board,
      window,
      metric: `${board}_${window}`,
      unit: meta.unit,
      entries,
      computedAt: computedAt.toISOString(),
      source: 'snapshot',
      cacheTtlSec: CACHE_TTL_SEC[window],
    };
  } catch (e: any) {
    logger.warn(
      { err: e?.message || String(e), board, window },
      '[rankings] snapshot read failed',
    );
    return null;
  }
}

async function followersBoard(limit: number): Promise<RankingBoardResponse> {
  const meta = BOARD_META.followers_total;
  const fs = getFirestore();
  if (!fs) {
    throw new EconomyError('PROVIDER_ERROR', 503, 'Firestore unavailable for followers rankings');
  }

  let snap;
  try {
    snap = await fs
      .collection('users')
      .orderBy('followersCount', 'desc')
      .limit(limit * 2)
      .get();
  } catch {
    snap = await fs.collection('users').orderBy('followers', 'desc').limit(limit * 2).get();
  }

  const entries: RankingEntry[] = [];
  for (const doc of snap.docs) {
    const data = (doc.data() || {}) as Record<string, unknown>;
    if (data.leaderboardOptOut === true || data.privacyHideFromRankings === true) continue;
    const score = Number(data.followersCount ?? data.followers ?? 0);
    if (!Number.isFinite(score) || score <= 0) continue;
    const displayName =
      str(data.displayName) || str(data.username) || str(data.handle) || 'Blyp user';
    const handle = str(data.username) || str(data.handle) || '';
    const photoURL =
      str(data.photoURL) || str(data.avatar) || str(data.profilePicture) || '';
    entries.push({
      rank: 0,
      userId: doc.id,
      score,
      displayName,
      photoURL,
      handle,
    });
    if (entries.length >= limit) break;
  }

  entries.forEach((e, i) => {
    e.rank = i + 1;
  });

  return {
    board: 'followers_total',
    window: 'alltime',
    metric: meta.metric,
    unit: meta.unit,
    entries,
    computedAt: new Date().toISOString(),
    source: 'firestore',
  };
}

/**
 * Cron / admin materialization: recompute coin_spend + gem_earn for
 * day/week/month/year into rankings_snapshots and warm Redis.
 */
export async function materializeRankingsSnapshots(opts?: {
  limit?: number;
  boards?: Array<'coin_spend' | 'gem_earn'>;
  windows?: Array<Exclude<RankingWindow, 'alltime'>>;
}): Promise<{
  ok: boolean;
  limit: number;
  results: RankingMaterializeResult[];
  durationMs: number;
}> {
  const started = Date.now();
  const limit = Math.max(1, Math.min(RANKINGS_SNAPSHOT_LIMIT, Math.floor(opts?.limit || RANKINGS_SNAPSHOT_LIMIT)));
  const boards = opts?.boards?.length ? opts.boards : ECONOMY_BOARDS;
  const windows = opts?.windows?.length ? opts.windows : WINDOWED;
  const results: RankingMaterializeResult[] = [];

  await ensureRankingsSnapshotsTable();

  for (const board of boards) {
    for (const window of windows) {
      const computedAt = new Date().toISOString();
      try {
        const entries = await aggregateLedgerWindow(board, window, limit);
        await persistSnapshot(board, window, entries, { throwOnError: true });
        await cacheInvalidateBoard(board, window);

        const meta = BOARD_META[board];
        const response: RankingBoardResponse = {
          board,
          window,
          metric: `${board}_${window}`,
          unit: meta.unit,
          entries: entries.slice(0, Math.min(25, limit)),
          computedAt,
          source: 'snapshot',
          cacheTtlSec: CACHE_TTL_SEC[window],
        };
        // Warm common client limits from the same rollup.
        for (const warmLimit of [10, 25, 50]) {
          if (warmLimit > limit) continue;
          await cacheSet(
            cacheKey(board, window, warmLimit),
            { ...response, entries: entries.slice(0, warmLimit) },
            CACHE_TTL_SEC[window],
          );
        }

        results.push({
          board,
          window,
          entryCount: entries.length,
          computedAt,
          ok: true,
        });
      } catch (e: any) {
        const msg = e?.message || String(e);
        logger.error({ err: msg, board, window }, '[rankings] materialize failed');
        results.push({
          board,
          window,
          entryCount: 0,
          computedAt,
          ok: false,
          error: msg,
        });
      }
    }
  }

  const ok = results.every((r) => r.ok);
  return { ok, limit, results, durationMs: Date.now() - started };
}

export async function getRankingBoard(
  boardRaw: string,
  limitRaw?: unknown,
  windowRaw?: unknown,
): Promise<RankingBoardResponse> {
  const board = String(boardRaw || '').trim() as RankingBoardId;
  if (!BOARD_META[board]) {
    throw new EconomyError('INVALID_INPUT', 400, 'Unknown rankings board', {
      board: boardRaw,
      allowed: Object.keys(BOARD_META),
    });
  }
  const limit = clampLimit(limitRaw);
  let window = parseWindow(windowRaw);

  // Followers delta needs a follow-event ledger (P2+). Total followers is all-time only.
  if (board === 'followers_total' && window !== 'alltime') {
    window = 'alltime';
  }

  const key = cacheKey(board, window, limit);
  const cached = await cacheGet(key);
  if (cached) return cached;

  let result: RankingBoardResponse;
  if (board === 'followers_total') {
    result = await followersBoard(limit);
  } else if (window === 'alltime') {
    result = await walletBoard(board, limit);
  } else {
    const fromSnap = await readSnapshotBoard(board, window, limit);
    result = fromSnap || (await ledgerWindowBoard(board, window, limit));
  }

  result.cacheTtlSec = CACHE_TTL_SEC[window];
  await cacheSet(key, result, CACHE_TTL_SEC[window]);
  return result;
}

export function listRankingBoardsMeta() {
  return (Object.keys(BOARD_META) as RankingBoardId[]).map((id) => ({
    board: id,
    windows: id === 'followers_total' ? (['alltime'] as RankingWindow[]) : WINDOWS,
    metric: BOARD_META[id].metric,
    unit: BOARD_META[id].unit,
    status: 'live' as const,
    note:
      id === 'followers_total'
        ? 'Windowed followers_delta needs follow-event history (P2+).'
        : 'Windowed boards prefer cron rankings_snapshots; fall back to ledger aggregates + Redis.',
  }));
}

export function listRankingWindows(): RankingWindow[] {
  return [...WINDOWS];
}
