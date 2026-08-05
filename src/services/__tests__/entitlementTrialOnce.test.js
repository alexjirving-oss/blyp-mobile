/**
 * Trial bootstrap payload must match Firestore create rules:
 * required keys only — no store / purchaseToken / currentPeriodEnd.
 */
import { buildTrialDoc, TRIAL_DAYS } from '../entitlementService';

describe('buildTrialDoc (once-per-account trial shape)', () => {
  it('includes required trial fields and omits forbidden paid keys', () => {
    const now = 1_700_000_000_000;
    const doc = buildTrialDoc(now);
    expect(doc).toEqual({
      tier: 'trial',
      status: 'trialing',
      trialStartedAt: now,
      trialEndsAt: now + TRIAL_DAYS * 86400000,
      updatedAt: now,
    });
    expect(Object.keys(doc).sort()).toEqual(
      ['tier', 'status', 'trialEndsAt', 'trialStartedAt', 'updatedAt'].sort()
    );
    expect(doc).not.toHaveProperty('store');
    expect(doc).not.toHaveProperty('purchaseToken');
    expect(doc).not.toHaveProperty('currentPeriodEnd');
  });
});
