// promoteBoostService.js
//
// Loads active coin-promote windows from the economy backend and attaches a
// capped boost onto posts / creators so discovery + For You can surface paid
// promotions without burying organic content.
//
// Pure helpers are import-safe for Jest; economyLiveApi is loaded lazily so
// unit tests do not pull Amplify / Cognito.

/** Score bump by promotion type. Kept below admin `boost` (150). */
export const PROMOTE_TYPE_WEIGHTS = Object.freeze({
  SPOTLIGHT: 95,
  TIME_SLOT: 70,
  BATTLE: 50,
});

/** Hard ceiling so stacked promos cannot dominate admin / organic ranking. */
export const PROMOTE_WEIGHT_CAP = 95;

/** Max share of promoted items in any fair-cap window (≈ 1 in 3). */
export const PROMOTE_MAX_SHARE = 1 / 3;

/** Max posts from the same promoted author inside one fair-cap window. */
export const PROMOTE_MAX_PER_USER = 2;

const CACHE_TTL_MS = 45_000;

/** @type {{ at: number, byUser: Map<string, { type: string, weight: number, battleRef: string|null }> } | null} */
let cache = null;
/** @type {Promise<Map<string, { type: string, weight: number, battleRef: string|null }>> | null} */
let inflight = null;

function normalizeType(raw) {
  const t = String(raw || '').trim().toUpperCase();
  if (t === 'SPOTLIGHT' || t === 'TIME_SLOT' || t === 'BATTLE') return t;
  return '';
}

export function promoteWeightForType(type) {
  const t = normalizeType(type);
  return PROMOTE_TYPE_WEIGHTS[t] || 0;
}

/**
 * Collapse overlapping promos for one user to the strongest active type.
 * @param {Array<{ userId?: string, promotionType?: string, battleRef?: string|null }>} promotions
 */
export function buildPromoteBoostByUser(promotions) {
  /** @type {Map<string, { type: string, weight: number, battleRef: string|null }>} */
  const byUser = new Map();
  for (const p of promotions || []) {
    const userId = String(p?.userId || '').trim();
    const type = normalizeType(p?.promotionType);
    if (!userId || !type) continue;
    const weight = Math.min(promoteWeightForType(type), PROMOTE_WEIGHT_CAP);
    if (weight <= 0) continue;
    const battleRef =
      p?.battleRef != null && String(p.battleRef).trim() ? String(p.battleRef).trim() : null;
    const prev = byUser.get(userId);
    if (!prev || weight > prev.weight) {
      byUser.set(userId, { type, weight, battleRef });
    }
  }
  return byUser;
}

async function fetchPromoteBoostByUser() {
  try {
    const { getActivePromotions } = await import('../api/economyLiveApi');
    const res = await getActivePromotions();
    return buildPromoteBoostByUser(res?.promotions || []);
  } catch (e) {
    console.warn('[PROMOTE_BOOST] active fetch failed', e?.message || String(e));
    return new Map();
  }
}

/** Cached map of userId → strongest active promote boost. */
export async function loadPromoteBoostByUser() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.byUser;
  if (inflight) return inflight;

  inflight = fetchPromoteBoostByUser()
    .then((byUser) => {
      cache = { at: Date.now(), byUser };
      return byUser;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Test helper — clear cache between tests. */
export function clearPromoteBoostCache() {
  cache = null;
  inflight = null;
}

function authorIdOf(post) {
  return String(post?.userId || post?.uid || post?.authorId || post?.id || '').trim();
}

/**
 * Attach promoteType / promoteBoostWeight onto posts from active promotions.
 * Best-effort: returns original posts (with zero boost) if the API is down.
 * @param {any[]} posts
 */
export async function attachPromoteBoost(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return posts || [];
  const byUser = await loadPromoteBoostByUser();
  if (!byUser.size) {
    return posts.map((p) => ({
      ...p,
      promoteType: null,
      promoteBoostWeight: 0,
      promoteBattleRef: null,
    }));
  }

  return posts.map((p) => {
    const aid = authorIdOf(p);
    const hit = aid ? byUser.get(aid) : null;
    if (!hit) {
      return {
        ...p,
        promoteType: null,
        promoteBoostWeight: 0,
        promoteBattleRef: null,
      };
    }
    return {
      ...p,
      promoteType: hit.type,
      promoteBoostWeight: hit.weight,
      promoteBattleRef: hit.battleRef,
    };
  });
}

export function promoteBoostAdjust(post) {
  const w = Number(post?.promoteBoostWeight || 0);
  if (!Number.isFinite(w) || w <= 0) return 0;
  return Math.min(w, PROMOTE_WEIGHT_CAP);
}

export function isPromotedPost(post) {
  return promoteBoostAdjust(post) > 0;
}

/**
 * Interleave so promoted content cannot monopolize the top of a rail/feed.
 * Preserves relative order within promoted and organic lists. Uses a sliding
 * window for share + per-author caps; prefers organic when the next promote
 * would violate caps.
 *
 * @param {any[]} posts  already ranked / shuffled
 * @param {{ windowSize?: number, maxShare?: number, maxPerUser?: number }} [opts]
 */
export function applyPromoteFairCap(posts, opts = {}) {
  if (!Array.isArray(posts) || posts.length <= 1) return posts || [];
  const windowSize = Math.max(3, Number(opts.windowSize) || 12);
  const maxShare = Math.min(1, Math.max(0.1, Number(opts.maxShare) || PROMOTE_MAX_SHARE));
  const maxPerUser = Math.max(1, Number(opts.maxPerUser) || PROMOTE_MAX_PER_USER);
  const maxPromoteInWindow = Math.max(1, Math.floor(windowSize * maxShare));

  const promoted = [];
  const organic = [];
  for (const p of posts) {
    if (isPromotedPost(p)) promoted.push(p);
    else organic.push(p);
  }
  if (promoted.length === 0) return posts;

  const canPlacePromote = (out, candidate) => {
    const recent = out.slice(Math.max(0, out.length - (windowSize - 1)));
    const window = [...recent, candidate];
    const promoteCount = window.filter((x) => isPromotedPost(x)).length;
    if (promoteCount > maxPromoteInWindow) return false;
    const uid = authorIdOf(candidate);
    if (!uid) return true;
    const userCount = window.filter((x) => authorIdOf(x) === uid).length;
    return userCount <= maxPerUser;
  };

  const out = [];
  let pi = 0;
  let oi = 0;

  while (pi < promoted.length || oi < organic.length) {
    const nextPromote = pi < promoted.length ? promoted[pi] : null;
    const nextOrganic = oi < organic.length ? organic[oi] : null;

    if (nextPromote && canPlacePromote(out, nextPromote)) {
      out.push(nextPromote);
      pi += 1;
      continue;
    }

    if (nextOrganic) {
      out.push(nextOrganic);
      oi += 1;
      continue;
    }

    // Organic exhausted — append remaining promote (may land outside the top window).
    if (nextPromote) {
      out.push(nextPromote);
      pi += 1;
      continue;
    }

    break;
  }

  return out;
}

export default {
  PROMOTE_TYPE_WEIGHTS,
  PROMOTE_WEIGHT_CAP,
  PROMOTE_MAX_SHARE,
  PROMOTE_MAX_PER_USER,
  promoteWeightForType,
  buildPromoteBoostByUser,
  loadPromoteBoostByUser,
  clearPromoteBoostCache,
  attachPromoteBoost,
  promoteBoostAdjust,
  isPromotedPost,
  applyPromoteFairCap,
};
