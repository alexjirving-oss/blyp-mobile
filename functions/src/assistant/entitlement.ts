/**
 * Premium / trial gate for AI features. Reads entitlements/{uid} — clients
 * cannot forge paid tiers (rules + activate CF). Trial is honored while
 * trialEndsAt is in the future.
 */

import { admin } from '../firebaseAdmin';
import { ASSISTANT_COLLECTIONS } from './types';

const PAID_TIERS = new Set(['plus', 'plus_coins']);
const STATUS_BLOCKS_PAID = new Set(['revoked', 'expired', 'on_hold', 'paused', 'inactive']);
const TRIAL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SubscriptionState {
  active: boolean;
  trialing: boolean;
  tier: string | null;
  currentPeriodEnd: number | null;
  trialEndsAt: number | null;
}

function emptyState(): SubscriptionState {
  return {
    active: false,
    trialing: false,
    tier: null,
    currentPeriodEnd: null,
    trialEndsAt: null,
  };
}

function computeFromDoc(d: any): SubscriptionState {
  const tier = typeof d?.tier === 'string' ? d.tier : null;
  const status = String(d?.status || '');
  const periodEnd = Number(d?.currentPeriodEnd || 0) || null;
  const trialEndsAt = Number(d?.trialEndsAt || 0) || null;
  const now = Date.now();

  const paidActive =
    !!tier &&
    PAID_TIERS.has(tier) &&
    !STATUS_BLOCKS_PAID.has(status) &&
    periodEnd != null &&
    periodEnd > now;

  const trialing =
    !paidActive &&
    ((status === 'trialing' && !!trialEndsAt && trialEndsAt > now) ||
      (tier === 'trial' && !!trialEndsAt && trialEndsAt > now));

  return {
    active: paidActive || trialing,
    trialing,
    tier,
    currentPeriodEnd: periodEnd,
    trialEndsAt,
  };
}

export async function getSubscriptionState(uid: string): Promise<SubscriptionState> {
  const db = admin.firestore();
  try {
    const snap = await db.collection(ASSISTANT_COLLECTIONS.entitlements).doc(uid).get();
    if (!snap.exists) return emptyState();
    return computeFromDoc(snap.data());
  } catch {
    // Fail CLOSED: premium features must not open on an infra error.
    return emptyState();
  }
}

/**
 * If the user has never received an entitlement doc, start the same 30-day
 * trial the mobile client expects. Does NOT renew expired free/expired docs.
 */
export async function ensureTrialIfMissing(uid: string): Promise<SubscriptionState> {
  const db = admin.firestore();
  const ref = db.collection(ASSISTANT_COLLECTIONS.entitlements).doc(uid);
  try {
    const snap = await ref.get();
    if (snap.exists) return computeFromDoc(snap.data());

    const now = Date.now();
    const doc = {
      tier: 'trial',
      status: 'trialing',
      trialStartedAt: now,
      trialEndsAt: now + TRIAL_DAYS * DAY_MS,
      store: null,
      updatedAt: now,
      source: 'geminiProxy_bootstrap',
    };
    // create() fails if another request won the race — re-read either way.
    try {
      await ref.create(doc);
    } catch {
      const again = await ref.get();
      if (again.exists) return computeFromDoc(again.data());
    }
    return computeFromDoc(doc);
  } catch {
    return emptyState();
  }
}
