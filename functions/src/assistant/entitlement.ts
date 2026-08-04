/**
 * Premium gate for the assistant. Reads the admin-written entitlements/{uid}
 * doc — the single source of truth a client can never forge — and reports
 * whether the user currently has an ACTIVE paid subscription.
 */

import { admin } from '../firebaseAdmin';
import { ASSISTANT_COLLECTIONS } from './types';

const PAID_TIERS = new Set(['plus', 'plus_coins']);

export interface SubscriptionState {
  active: boolean;
  tier: string | null;
  currentPeriodEnd: number | null;
}

export async function getSubscriptionState(uid: string): Promise<SubscriptionState> {
  const db = admin.firestore();
  try {
    const snap = await db.collection(ASSISTANT_COLLECTIONS.entitlements).doc(uid).get();
    if (!snap.exists) return { active: false, tier: null, currentPeriodEnd: null };
    const d = snap.data() as any;
    const tier = typeof d?.tier === 'string' ? d.tier : null;
    const status = String(d?.status || '');
    const periodEnd = Number(d?.currentPeriodEnd || 0) || null;
    const active =
      status === 'active' &&
      !!tier &&
      PAID_TIERS.has(tier) &&
      (periodEnd == null || periodEnd > Date.now());
    return { active, tier, currentPeriodEnd: periodEnd };
  } catch {
    // Fail CLOSED here: a premium feature must not open on an infra error.
    return { active: false, tier: null, currentPeriodEnd: null };
  }
}
