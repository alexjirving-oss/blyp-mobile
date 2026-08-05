/**
 * Global rankings (Phase 0).
 *
 * Reads denormalized wallet counters — never scans all users from the client.
 * Windowed day/week/month/year boards land in Phase 1 via scheduled ledger rollups.
 */

import { getEconomyInfra } from './infra';
import { EconomyError } from './economyErrors';
import { getFirestore } from '../admin/firestoreAdmin';

export type RankingBoardId = 'coin_spend' | 'gem_earn' | 'followers_total';

export type RankingEntry = {
  rank: number;
  userId: string;
  score: number;
  displayName: string;
  photoURL: string;
  handle: string;
};

export type RankingBoardResponse = {
  board: RankingBoardId;
  window: 'alltime';
  metric: string;
  unit: string;
  entries: RankingEntry[];
  computedAt: string;
};

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

function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 25;
  return Math.max(1, Math.min(50, Math.floor(n)));
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
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

  // Firestore getAll batches up to 100; Phase 0 caps at 50.
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
    .limit(limit * 2); // over-fetch to allow opt-out filtering

  const ids = rows.map((r: any) => String(r.user_id || '')).filter(Boolean);
  const profiles = await enrichProfiles(ids);

  const entries: RankingEntry[] = [];
  for (const r of rows) {
    const userId = String(r.user_id || '');
    if (!userId) continue;
    const profile = profiles.get(userId);
    if (profile?.optOut) continue;
    const score = Number(r[column] || 0);
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

  return {
    board,
    window: 'alltime',
    metric: meta.metric,
    unit: meta.unit,
    entries,
    computedAt: new Date().toISOString(),
  };
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
    // Fallback if followersCount index/field sparse: try legacy alias.
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
  };
}

export async function getRankingBoard(
  boardRaw: string,
  limitRaw?: unknown,
): Promise<RankingBoardResponse> {
  const board = String(boardRaw || '').trim() as RankingBoardId;
  if (!BOARD_META[board]) {
    throw new EconomyError('INVALID_INPUT', 400, 'Unknown rankings board', {
      board: boardRaw,
      allowed: Object.keys(BOARD_META),
    });
  }
  const limit = clampLimit(limitRaw);

  if (board === 'followers_total') return followersBoard(limit);
  return walletBoard(board, limit);
}

export function listRankingBoardsMeta() {
  return (Object.keys(BOARD_META) as RankingBoardId[]).map((id) => ({
    board: id,
    window: 'alltime' as const,
    metric: BOARD_META[id].metric,
    unit: BOARD_META[id].unit,
    status: 'live' as const,
  }));
}
