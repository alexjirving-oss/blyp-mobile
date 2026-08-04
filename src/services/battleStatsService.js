// battleStatsService — client reads for the Battle Leaderboard + Diary header.
//
// Reads the server-maintained `battleStats/{uid}` aggregates (written ONLY by the
// onBattleComplete Cloud Function via the Admin SDK). Scoring is GLORY/POINTS
// ONLY — there is no money, payout, prize or wager anywhere in here. The points
// rules below are mirrored from functions/src/battles/battleStats.ts so the app
// can show an honest "How points work" note.

import { db, firebaseEnabled } from '../config/firebase';

const BATTLE_STATS = 'battleStats';

// Transparent, points-only glory weights (mirror of the Cloud Function's GLORY).
export const GLORY_RULES = {
  showUp: 1,
  win: 3,
  draw: 1,
  streakStep: 1,
  streakBonusCap: 5,
};

// Human-readable rows for the in-UI "How points work" explainer.
export const GLORY_RULE_LINES = [
  { icon: 'checkmark-circle-outline', label: 'Show up for a battle', value: '+1' },
  { icon: 'trophy-outline', label: 'Win a battle', value: '+3' },
  { icon: 'git-compare-outline', label: 'Draw a battle', value: '+1' },
  { icon: 'flame-outline', label: 'Win streak (each win in a row)', value: `+1 up to +${GLORY_RULES.streakBonusCap}` },
];

/** ISO-week key (UTC, Monday-start) for "now" — mirrors the Cloud Function. */
export function currentWeekKey(ms = Date.now()) {
  const d = new Date(ms);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
    );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Win-rate as a 0–100 integer, guarded against zero battles. */
export function winRate(stats) {
  const played = Number(stats?.battlesPlayed) || 0;
  if (played <= 0) return 0;
  const wins = Number(stats?.wins) || 0;
  return Math.round((wins / played) * 100);
}

function ready() {
  return firebaseEnabled && db && typeof db.collection === 'function';
}

function normalize(id, data) {
  const d = data || {};
  return {
    uid: d.uid || id,
    displayName: d.displayName || 'Creator',
    photoURL: d.photoURL || '',
    handle: d.handle || '',
    wins: Number(d.wins) || 0,
    losses: Number(d.losses) || 0,
    draws: Number(d.draws) || 0,
    battlesPlayed: Number(d.battlesPlayed) || 0,
    gloryPoints: Number(d.gloryPoints) || 0,
    currentStreak: Number(d.currentStreak) || 0,
    bestStreak: Number(d.bestStreak) || 0,
    weekKey: d.weekKey || '',
    weeklyGloryPoints: Number(d.weeklyGloryPoints) || 0,
    weeklyWins: Number(d.weeklyWins) || 0,
    weeklyBattlesPlayed: Number(d.weeklyBattlesPlayed) || 0,
    updatedAt: d.updatedAt || null,
  };
}

/**
 * Fetch a page of the leaderboard.
 *   scope: 'alltime' (orderBy gloryPoints) | 'week' (orderBy weeklyGloryPoints).
 * Uses a single orderBy (no composite index). The weekly view additionally
 * filters client-side to the current week so stale weekly buckets drop off.
 * Returns { rows, cursor, hasMore }. Pass the returned cursor back to page on.
 */
export async function fetchLeaderboardPage({ scope = 'alltime', pageSize = 25, cursor = null } = {}) {
  if (!ready()) return { rows: [], cursor: null, hasMore: false };
  const field = scope === 'week' ? 'weeklyGloryPoints' : 'gloryPoints';
  try {
    // Over-fetch a little for the weekly view because we filter stale weeks out.
    const fetchSize = scope === 'week' ? pageSize * 2 : pageSize;
    let q = db.collection(BATTLE_STATS).orderBy(field, 'desc').limit(fetchSize);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    const docs = snap?.docs || [];
    const lastDoc = docs.length ? docs[docs.length - 1] : null;
    let rows = docs.map((doc) => normalize(doc.id, doc.data()));
    if (scope === 'week') {
      const wk = currentWeekKey();
      rows = rows.filter((r) => r.weekKey === wk && r.weeklyGloryPoints > 0);
    } else {
      rows = rows.filter((r) => r.gloryPoints > 0 || r.battlesPlayed > 0);
    }
    return {
      rows,
      cursor: lastDoc,
      hasMore: docs.length >= fetchSize,
    };
  } catch {
    return { rows: [], cursor: null, hasMore: false };
  }
}

/** One-shot read of a single user's stats (diary header). Null if none yet. */
export async function getMyStats(uid) {
  if (!ready() || !uid) return null;
  try {
    const snap = await db.collection(BATTLE_STATS).doc(uid).get();
    const data = typeof snap?.data === 'function' ? snap.data() : null;
    if (!data) return null;
    return normalize(uid, data);
  } catch {
    return null;
  }
}

/** Live subscription to a user's own stats. Returns an unsubscribe fn. */
export function subscribeMyStats(uid, cb) {
  if (!ready() || !uid) {
    try { cb(null); } catch { /* ignore */ }
    return () => {};
  }
  try {
    return db
      .collection(BATTLE_STATS)
      .doc(uid)
      .onSnapshot(
        (snap) => {
          const data = typeof snap?.data === 'function' ? snap.data() : null;
          try { cb(data ? normalize(uid, data) : null); } catch { /* ignore */ }
        },
        () => { try { cb(null); } catch { /* ignore */ } }
      );
  } catch {
    try { cb(null); } catch { /* ignore */ }
    return () => {};
  }
}

export default {
  GLORY_RULES,
  GLORY_RULE_LINES,
  currentWeekKey,
  winRate,
  fetchLeaderboardPage,
  getMyStats,
  subscribeMyStats,
};
