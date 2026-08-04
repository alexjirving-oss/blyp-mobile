// blypReachClient.js
//
// Client bridge for Blyp's "earn-your-reach" distribution model (see BLYP_CHARTER.md
// and functions/src/distribution/*). It does three things:
//
//   1. Reports post signals (impressions, likes, shares, saves, watch-through) to the
//      backend in small batches. These feed each post's transparent Blyp Score.
//   2. Stamps a fair starting reach state on a brand-new post (audition).
//   3. Reads a post's reach state back into plain English for the creator.
//
// Everything is fire-and-forget and degrades safely: if the endpoint isn't configured
// (e.g. before deploy) reporting is a no-op and the app behaves exactly as before.

const SEARCH_URL = process.env.EXPO_PUBLIC_BLYP_SEARCH_URL || '';
const POST_EVENT_URL =
  process.env.EXPO_PUBLIC_BLYP_POST_EVENT_URL ||
  (SEARCH_URL ? SEARCH_URL.replace(/blypSearch(Event)?/, 'blypPostEvent') : '');

// Keep these in step with functions/src/distribution/reach.ts (server is authority).
export const REACH_VERSION = 1;
const WAVE_EXPOSURE = [0.08, 0.2, 0.45, 0.75, 1.0];
const MAX_WAVE = WAVE_EXPOSURE.length - 1;

const FLUSH_INTERVAL_MS = 8000;
const FLUSH_AT = 20;

let queue = [];
let timer = null;
let session = 'anon';

/** Set the (anonymous-to-the-server) session id used to de-bias signals. */
export function setReachSession(uid) {
  if (uid) session = String(uid);
}

function scheduleFlush() {
  if (timer || !POST_EVENT_URL) return;
  timer = setTimeout(() => {
    timer = null;
    flushReachEvents();
  }, FLUSH_INTERVAL_MS);
}

/** Send any queued events now. Safe to call often; no-op when empty/unconfigured. */
export function flushReachEvents() {
  if (!POST_EVENT_URL || queue.length === 0) return;
  const events = queue;
  queue = [];
  try {
    fetch(POST_EVENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, events }),
    }).catch(() => {});
  } catch {
    /* non-fatal */
  }
}

function enqueue(ev) {
  if (!POST_EVENT_URL || !ev?.postId || !ev?.type) return;
  queue.push(ev);
  if (queue.length >= FLUSH_AT) flushReachEvents();
  else scheduleFlush();
}

// Avoid double-counting a feed impression for the same post within a session run.
const seenImpressions = new Set();

export function reportImpression(postId, ownerId) {
  if (!postId || seenImpressions.has(postId)) return;
  seenImpressions.add(postId);
  enqueue({ type: 'impression', postId, ownerId });
}

export function reportEngagement(type, postId, ownerId, extra = {}) {
  if (!postId || !type) return;
  enqueue({ type, postId, ownerId, ...extra });
}

export function reportWatch(postId, ownerId, dwellMs, completion) {
  if (!postId) return;
  enqueue({
    type: 'watch',
    postId,
    ownerId,
    dwellMs: dwellMs > 0 ? dwellMs : undefined,
    completion: typeof completion === 'number' ? completion : undefined,
  });
}

/** Fair starting reach for a brand-new post (mirrors server initialReach). */
export function initialReachState() {
  const now = Date.now();
  return {
    v: REACH_VERSION,
    wave: 0,
    stage: 'audition',
    exposure: WAVE_EXPOSURE[0],
    score: 0,
    impressions: 0,
    waveImpressions: 0,
    engagements: { likes: 0, comments: 0, shares: 0, saves: 0, completions: 0, dwellMsTotal: 0 },
    version: 1,
    enteredWaveAt: now,
    lastScoredAt: now,
    updatedAt: now,
  };
}

const STAGE_COPY = {
  audition: {
    label: 'In audition',
    headline: 'Auditioning with a first small audience',
    detail:
      'Every post starts here. Blyp is showing it to a small sample of people. If they genuinely engage, it earns a bigger wave — automatically, with no payment needed.',
  },
  rising: {
    label: 'Rising',
    headline: 'Earning its way to more people',
    detail:
      'People are responding well, so Blyp keeps widening the audience wave by wave. Reach is being earned purely on how real viewers react.',
  },
  graduated: {
    label: 'Established',
    headline: 'Earned full organic reach',
    detail:
      'This post connected and is now eligible for full organic reach. It will still rise or settle naturally based on ongoing interest.',
  },
  resting: {
    label: 'Resting',
    headline: 'Resting for now — it can recover',
    detail:
      'This one didn’t connect with its audition audience yet, so Blyp has eased off. It is never hidden or deleted, and a fresh wave of interest can revive it. Editing it gives it a brand-new audition.',
  },
};

/**
 * Turn a post's reach state into something a creator can actually read and act on.
 * Legacy posts with no reach state are treated as already established (no surprises).
 */
export function reachSummary(post) {
  const r = post?.reach;
  if (!r || typeof r !== 'object') {
    return {
      has: false,
      stage: 'graduated',
      label: 'Established',
      score: null,
      exposurePct: 100,
      impressions: 0,
      headline: 'Out in the feed',
      detail: 'This post predates Blyp Score, so it’s treated as already established.',
      tips: [],
    };
  }
  const stage = STAGE_COPY[r.stage] ? r.stage : 'audition';
  const copy = STAGE_COPY[stage];
  const exposurePct = Math.round((r.exposure ?? WAVE_EXPOSURE[Math.min(r.wave || 0, MAX_WAVE)]) * 100);
  const tips = [];
  if (stage === 'audition' || stage === 'resting') {
    tips.push('A strong hook in the first few seconds lifts watch-through the most.');
    tips.push('Replies, shares and saves count more than likes.');
  }
  if (stage === 'resting') {
    tips.push('Editing the post gives it a brand-new, no-penalty audition.');
  }
  return {
    has: true,
    stage,
    label: copy.label,
    score: typeof r.score === 'number' ? r.score : 0,
    wave: r.wave || 0,
    maxWave: MAX_WAVE,
    exposurePct,
    impressions: r.impressions || 0,
    headline: copy.headline,
    detail: copy.detail,
    tips,
  };
}

export default {
  setReachSession,
  reportImpression,
  reportEngagement,
  reportWatch,
  flushReachEvents,
  initialReachState,
  reachSummary,
};
