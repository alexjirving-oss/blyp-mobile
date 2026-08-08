/**
 * CommonJS twin of src/utils/publishSchedule.js for the import worker.
 * Keep behaviour in sync when changing defaults/caps.
 */
'use strict';

const PUBLISH_STATUS = {
  LIVE: 'live',
  SCHEDULED: 'scheduled',
  PAUSED: 'paused',
  CANCELED: 'canceled',
};

const STAGGER_DEFAULTS = {
  enabled: true,
  postsPerDay: 3,
  jitterMs: 15 * 60 * 1000,
  maxPostsPerDay: 12,
  minIntervalMs: 30 * 60 * 1000,
  maxJitterMs: 30 * 60 * 1000,
};

const STAGGER_ADMIN = {
  maxPostsPerDay: 48,
  minIntervalMs: 5 * 60 * 1000,
  maxJitterMs: 2 * 60 * 60 * 1000,
};

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

function normalizeStagger(raw, opts = {}) {
  const isAdmin = !!(opts.isAdmin || (raw && raw.isAdmin));
  const caps = isAdmin
    ? STAGGER_ADMIN
    : {
      maxPostsPerDay: STAGGER_DEFAULTS.maxPostsPerDay,
      minIntervalMs: STAGGER_DEFAULTS.minIntervalMs,
      maxJitterMs: STAGGER_DEFAULTS.maxJitterMs,
    };

  const enabled = !(raw && (raw.enabled === false || raw.enabled === 0 || raw.enabled === '0'));
  if (!enabled) return { enabled: false, isAdmin };

  const postsPerDay = clamp(
    raw && raw.postsPerDay != null ? raw.postsPerDay : STAGGER_DEFAULTS.postsPerDay,
    1,
    caps.maxPostsPerDay,
  );

  let intervalMs;
  if (raw && raw.intervalMs != null && Number.isFinite(Number(raw.intervalMs))) {
    intervalMs = clamp(Number(raw.intervalMs), caps.minIntervalMs, 7 * 24 * 60 * 60 * 1000);
  } else {
    intervalMs = Math.max(caps.minIntervalMs, Math.floor((24 * 60 * 60 * 1000) / postsPerDay));
  }

  const startAt = raw && Number(raw.startAt) > 0 ? Number(raw.startAt) : Date.now();

  let jitterMs;
  if (raw && raw.jitterMs != null && Number.isFinite(Number(raw.jitterMs))) {
    jitterMs = clamp(Number(raw.jitterMs), 0, caps.maxJitterMs);
  } else {
    jitterMs = Math.min(STAGGER_DEFAULTS.jitterMs, Math.floor(intervalMs * 0.25), caps.maxJitterMs);
  }

  return { enabled: true, isAdmin, postsPerDay, intervalMs, startAt, jitterMs };
}

function publishAtForIndex(stagger, index, now = Date.now(), rng = Math.random) {
  if (!stagger || !stagger.enabled) return now;
  const i = Math.max(0, Math.floor(Number(index) || 0));
  const base = Number(stagger.startAt) + i * Number(stagger.intervalMs);
  const j = Number(stagger.jitterMs) > 0
    ? Math.floor((rng() * 2 - 1) * Number(stagger.jitterMs))
    : 0;
  return Math.max(now + 1000, base + j);
}

module.exports = {
  PUBLISH_STATUS,
  STAGGER_DEFAULTS,
  STAGGER_ADMIN,
  normalizeStagger,
  publishAtForIndex,
};
