/**
 * Staggered publish helpers for social import (and future compose scheduling).
 *
 * Defaults favour everyone (not dump-all-live). Admins may pass higher caps
 * via `isAdmin: true` when creating a job through the admin console.
 */

export const PUBLISH_STATUS = {
  LIVE: 'live',
  SCHEDULED: 'scheduled',
  PAUSED: 'paused',
  CANCELED: 'canceled',
};

/** User defaults / caps */
export const STAGGER_DEFAULTS = {
  enabled: true,
  postsPerDay: 3,
  /** ┬▒ jitter around each slot; 0 = exact cadence */
  jitterMs: 15 * 60 * 1000,
  maxPostsPerDay: 12,
  minIntervalMs: 30 * 60 * 1000,
  maxJitterMs: 30 * 60 * 1000,
};

/** Admin overrides (staff seeding / ops) */
export const STAGGER_ADMIN = {
  maxPostsPerDay: 48,
  minIntervalMs: 5 * 60 * 1000,
  maxJitterMs: 2 * 60 * 60 * 1000,
};

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Normalize stagger options from the client or an admin job doc.
 * @param {object|null|undefined} raw
 * @param {{ isAdmin?: boolean }} [opts]
 */
export function normalizeStagger(raw, opts = {}) {
  const isAdmin = !!opts.isAdmin || !!raw?.isAdmin;
  const caps = isAdmin ? STAGGER_ADMIN : {
    maxPostsPerDay: STAGGER_DEFAULTS.maxPostsPerDay,
    minIntervalMs: STAGGER_DEFAULTS.minIntervalMs,
    maxJitterMs: STAGGER_DEFAULTS.maxJitterMs,
  };

  // Explicit false disables; missing/undefined → default ON for imports.
  const enabled = raw?.enabled !== false && raw?.enabled !== 0 && raw?.enabled !== '0';
  if (!enabled) {
    return { enabled: false, isAdmin };
  }

  const maxPerDay = caps.maxPostsPerDay;
  const postsPerDay = clamp(
    raw?.postsPerDay != null ? raw.postsPerDay : STAGGER_DEFAULTS.postsPerDay,
    1,
    maxPerDay,
  );

  let intervalMs;
  if (raw?.intervalMs != null && Number.isFinite(Number(raw.intervalMs))) {
    intervalMs = clamp(Number(raw.intervalMs), caps.minIntervalMs, 7 * 24 * 60 * 60 * 1000);
  } else {
    intervalMs = Math.max(caps.minIntervalMs, Math.floor((24 * 60 * 60 * 1000) / postsPerDay));
  }

  const startAt = Number(raw?.startAt) > 0 ? Number(raw.startAt) : Date.now();

  let jitterMs;
  if (raw?.jitterMs != null && Number.isFinite(Number(raw.jitterMs))) {
    jitterMs = clamp(Number(raw.jitterMs), 0, caps.maxJitterMs);
  } else {
    jitterMs = Math.min(STAGGER_DEFAULTS.jitterMs, Math.floor(intervalMs * 0.25), caps.maxJitterMs);
  }

  return {
    enabled: true,
    isAdmin,
    postsPerDay,
    intervalMs,
    startAt,
    jitterMs,
  };
}

/**
 * Compute publishAt for the Nth newly-imported item (0-based).
 * Never returns a time in the past (clamps to ~now+1s).
 */
export function publishAtForIndex(stagger, index, now = Date.now(), rng = Math.random) {
  if (!stagger?.enabled) return now;
  const i = Math.max(0, Math.floor(Number(index) || 0));
  const base = Number(stagger.startAt) + i * Number(stagger.intervalMs);
  const j = Number(stagger.jitterMs) > 0
    ? Math.floor((rng() * 2 - 1) * Number(stagger.jitterMs))
    : 0;
  return Math.max(now + 1000, base + j);
}

/** True when a post should appear in public feeds / other people's profiles. */
export function isLivePublishStatus(post) {
  if (!post) return false;
  const s = post.publishStatus;
  if (s == null || s === '' || s === PUBLISH_STATUS.LIVE) return true;
  return false;
}

/** Scheduled / paused / canceled — keep out of public discovery. */
export function isNonLivePublishStatus(post) {
  return !isLivePublishStatus(post);
}

export function formatPublishAt(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  try {
    return new Date(n).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export default {
  PUBLISH_STATUS,
  STAGGER_DEFAULTS,
  STAGGER_ADMIN,
  normalizeStagger,
  publishAtForIndex,
  isLivePublishStatus,
  isNonLivePublishStatus,
  formatPublishAt,
};
