export type AgeBand = 'under_13' | '13_15' | '16_17' | '18_plus';
export type ConsentStatus = 'accepted' | 'withdrawn';
export type PolicyCapability = 'view' | 'contact' | 'discover' | 'join' | 'transact';

export type TrustPolicyProfile = {
  userId: string;
  dateOfBirth: string;
  ageBand: AgeBand;
  jurisdiction: string;
  consentStatus: ConsentStatus;
  acceptedPolicyVersion: string;
  acceptanceSource: 'mobile' | 'web' | 'admin' | 'migration';
  acceptedAt: string | null;
  withdrawnAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TrustPrivacySettings = {
  userId: string;
  accountVisibility: 'public' | 'followers' | 'private';
  contentVisibility: 'public' | 'followers' | 'private';
  messagePermission: 'everyone' | 'followers' | 'nobody';
  discoverability: 'discoverable' | 'followers_only' | 'hidden';
  locationPrecision: 'off' | 'approximate' | 'precise';
  allowPersonalization: boolean;
  allowAnalytics: boolean;
  allowAiTraining: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TrustDecision = {
  allowed: boolean;
  capability: PolicyCapability;
  reasons: string[];
  policyProfileVersion: number | null;
  privacyVersion: number | null;
};

export type RelationshipSignals = {
  targetConsentActive: boolean;
  actorBlockedTarget: boolean;
  targetBlockedActor: boolean;
  actorMutedTarget: boolean;
  targetMutedActor: boolean;
};

export const DEFAULT_PRIVACY_SETTINGS = {
  accountVisibility: 'private',
  contentVisibility: 'followers',
  messagePermission: 'nobody',
  discoverability: 'hidden',
  locationPrecision: 'off',
  allowPersonalization: false,
  allowAnalytics: false,
  allowAiTraining: false,
} as const;

const AGE_BAND_RANK: Record<AgeBand, number> = {
  under_13: 0,
  '13_15': 1,
  '16_17': 2,
  '18_plus': 3,
};

function parseIsoDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('dateOfBirth must use YYYY-MM-DD.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('dateOfBirth is not a valid calendar date.');
  }
  return { year, month, day };
}

export function ageOnDate(dateOfBirth: string, asOf: Date = new Date()): number {
  const birth = parseIsoDate(dateOfBirth);
  const asOfYear = asOf.getUTCFullYear();
  const asOfMonth = asOf.getUTCMonth() + 1;
  const asOfDay = asOf.getUTCDate();
  let age = asOfYear - birth.year;
  if (asOfMonth < birth.month || (asOfMonth === birth.month && asOfDay < birth.day)) age -= 1;
  if (age < 0 || age > 130) throw new Error('dateOfBirth is outside the accepted age range.');
  return age;
}

export function deriveAgeBand(dateOfBirth: string, asOf: Date = new Date()): AgeBand {
  const age = ageOnDate(dateOfBirth, asOf);
  if (age < 13) return 'under_13';
  if (age < 16) return '13_15';
  if (age < 18) return '16_17';
  return '18_plus';
}

export function isAgeBandAtLeast(actual: AgeBand, required: AgeBand): boolean {
  return AGE_BAND_RANK[actual] >= AGE_BAND_RANK[required];
}

export function evaluateBaselinePolicy(input: {
  capability: PolicyCapability;
  profile: TrustPolicyProfile | null;
  privacy: TrustPrivacySettings | null;
  minimumAgeBand?: AgeBand;
}): TrustDecision {
  const reasons: string[] = [];
  const { capability, profile, privacy } = input;

  if (!profile) reasons.push('CONSENT_PROFILE_MISSING');
  else if (profile.consentStatus !== 'accepted') reasons.push('CONSENT_NOT_ACCEPTED');

  if (profile && input.minimumAgeBand && !isAgeBandAtLeast(profile.ageBand, input.minimumAgeBand)) {
    reasons.push('AGE_BAND_INELIGIBLE');
  }

  if (!privacy) reasons.push('PRIVACY_SETTINGS_MISSING');
  else {
    if (capability === 'contact') {
      if (privacy.messagePermission === 'nobody') reasons.push('CONTACT_DISABLED_BY_PRIVACY');
      if (privacy.messagePermission === 'followers') reasons.push('FOLLOW_RELATIONSHIP_REQUIRED');
    }
    if (capability === 'discover') {
      if (privacy.discoverability === 'hidden') reasons.push('DISCOVERY_DISABLED_BY_PRIVACY');
      if (privacy.discoverability === 'followers_only') reasons.push('FOLLOW_RELATIONSHIP_REQUIRED');
    }
    if (capability === 'view') {
      if (privacy.accountVisibility === 'private') reasons.push('ACCOUNT_PRIVATE');
      if (privacy.contentVisibility === 'private') reasons.push('CONTENT_PRIVATE');
      if (privacy.accountVisibility === 'followers' || privacy.contentVisibility === 'followers') {
        reasons.push('FOLLOW_RELATIONSHIP_REQUIRED');
      }
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    allowed: uniqueReasons.length === 0,
    capability,
    reasons: uniqueReasons,
    policyProfileVersion: profile?.version ?? null,
    privacyVersion: privacy?.version ?? null,
  };
}

export function applyRelationshipPolicy(
  baseline: TrustDecision,
  signals: RelationshipSignals
): TrustDecision {
  const reasons = [...baseline.reasons];
  if (!signals.targetConsentActive) reasons.push('TARGET_CONSENT_INACTIVE');
  if (signals.actorBlockedTarget || signals.targetBlockedActor) reasons.push('BLOCKED_RELATIONSHIP');
  if (signals.actorMutedTarget && ['view', 'discover'].includes(baseline.capability)) {
    reasons.push('MUTED_BY_ACTOR');
  }
  if (signals.targetMutedActor && baseline.capability === 'contact') {
    reasons.push('MUTED_BY_TARGET');
  }
  const uniqueReasons = [...new Set(reasons)];
  return { ...baseline, allowed: uniqueReasons.length === 0, reasons: uniqueReasons };
}
