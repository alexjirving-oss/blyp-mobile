// entitlementService.js
//
// Single source of truth for "what plan is this user on, and what can they do".
// See BLYP_CHARTER.md → Money → Plans.
//
// Trust model (important): the trial is self-serve (a user may start their own
// 30-day trial), but PAID tiers are written only by the server after a verified
// store purchase — the Firestore rules make `entitlements/{uid}` create trial-only
// and update server-only, so a user cannot quietly promote themselves to Plus.
//
// Fail-open: if entitlement can't be read, we assume full access rather than wrongly
// locking someone out. Reach is never affected by any of this — plans buy features
// and coins, never distribution.

import { db, firebaseEnabled } from '../config/firebase';
import { snapExists, snapData } from '../utils/firestoreSnap';
import { ensureFirebaseAuthReady } from '../utils/firebaseAuthHelper';

export const TRIAL_DAYS = 30;
const DAY = 86400000;

export const TIERS = {
  TRIAL: 'trial',
  FREE: 'free',
  PLUS: 'plus',
  PLUS_COINS: 'plus_coins',
};

// Capability matrix per effective tier. `ai` is the premium AI conveniences
// (Blyp AI answers + voice, AI captions/hashtags/titles, AI sport pages).
const CAPS = {
  trial: { ai: true, monthlyCoins: 0 },
  free: { ai: false, monthlyCoins: 0 },
  plus: { ai: true, monthlyCoins: 0 },
  plus_coins: { ai: true, monthlyCoins: 999 },
};

// Subscription statuses that revoke access immediately regardless of the stored
// period end. RTDN sets these (+ currentPeriodEnd in the past), but we honor the
// status explicitly so a revoke/expire/hold/pause can never be ignored.
const STATUS_BLOCKS_PAID = new Set(['revoked', 'expired', 'on_hold', 'paused', 'inactive']);

function computeEffective(doc) {
  const now = Date.now();
  const tier = doc?.tier || 'trial';
  const trialEndsAt = Number(doc?.trialEndsAt || 0);
  const currentPeriodEnd = Number(doc?.currentPeriodEnd || 0);
  const status = doc?.status || null;

  let effectiveTier = 'free';
  let trialing = false;
  let trialDaysLeft = 0;

  if (tier === 'plus' || tier === 'plus_coins') {
    // A paid tier only grants access when the paid period is still live AND the
    // status hasn't been revoked/expired/held/paused. The server always writes a
    // currentPeriodEnd on activation, so a paid tier without one is treated as
    // lapsed (fail-closed) rather than honored forever.
    const periodActive = currentPeriodEnd > now;
    const statusOk = !STATUS_BLOCKS_PAID.has(String(status || ''));
    effectiveTier = periodActive && statusOk ? tier : 'free';
  } else if (trialEndsAt && now < trialEndsAt) {
    effectiveTier = 'trial';
    trialing = true;
    trialDaysLeft = Math.max(0, Math.ceil((trialEndsAt - now) / DAY));
  } else {
    effectiveTier = 'free';
  }

  // "Past due" = they HAD a paid tier but it has lapsed to free (failed
  // conversion/renewal, account hold, expiry or revoke). Used to show a distinct
  // "your payment didn't go through" banner vs a plain free-tier upsell.
  const paidTier = tier === 'plus' || tier === 'plus_coins';
  const pastDue = paidTier && effectiveTier === 'free';

  return {
    tier,
    effectiveTier,
    trialing,
    trialDaysLeft,
    trialEndsAt,
    currentPeriodEnd,
    status: doc?.status || null,
    pastDue,
    capabilities: CAPS[effectiveTier] || CAPS.free,
  };
}

let cache = null;
const listeners = new Set();

/** Last known entitlement (may be null before the first load). */
export function getEntitlementCached() {
  return cache;
}

/** Does the user currently have the premium AI capability? Fail-open while unknown. */
export function hasAICached() {
  return cache ? !!cache.capabilities.ai : true;
}

async function bootstrapTrial(uid) {
  const now = Date.now();
  const doc = {
    tier: 'trial',
    status: 'trialing',
    trialStartedAt: now,
    trialEndsAt: now + TRIAL_DAYS * DAY,
    store: null,
    updatedAt: now,
  };
  try {
    await ensureFirebaseAuthReady({ uid, timeoutMs: 15000 });
    await db.collection('entitlements').doc(uid).set(doc, { merge: false });
    return doc;
  } catch (e) {
    console.warn('[entitlement] trial bootstrap failed (non-fatal)', e?.message || String(e));
    // Don't invent a fresh countdown client-side if the write didn't stick —
    // that restarts the 30-day trial on every login. Re-read; else free tier.
    try {
      const snap = await db.collection('entitlements').doc(uid).get();
      if (snapExists(snap)) return snapData(snap);
    } catch {
      /* ignore */
    }
    return { tier: 'free', status: 'inactive', trialEndsAt: 0, updatedAt: now };
  }
}

/** Load + compute the entitlement for a user, caching and notifying listeners. */
export async function loadEntitlement(uid) {
  const fallback = computeEffective({ tier: 'free', trialEndsAt: 0 });
  if (!firebaseEnabled || !db || typeof db.collection !== 'function' || !uid) {
    cache = fallback;
    return cache;
  }
  try {
    try {
      await ensureFirebaseAuthReady({ uid, timeoutMs: 15000 });
    } catch {
      /* continue — read may still work if already bridged */
    }
    const ref = db.collection('entitlements').doc(uid);
    const snap = await ref.get();
    const data = snapExists(snap) ? snapData(snap) : await bootstrapTrial(uid);
    cache = computeEffective(data);
  } catch (e) {
    console.warn('[entitlement] load failed, assuming free tier', e?.message || String(e));
    cache = fallback;
  }
  listeners.forEach((l) => {
    try {
      l(cache);
    } catch {
      /* ignore */
    }
  });
  return cache;
}

/** Subscribe to entitlement changes; triggers a load. Returns an unsubscribe fn. */
export function subscribeEntitlement(uid, cb) {
  listeners.add(cb);
  loadEntitlement(uid).then(cb);
  return () => {
    listeners.delete(cb);
  };
}

export default {
  TIERS,
  TRIAL_DAYS,
  getEntitlementCached,
  hasAICached,
  loadEntitlement,
  subscribeEntitlement,
};
