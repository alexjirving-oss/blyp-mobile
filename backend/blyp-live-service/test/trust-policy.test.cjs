const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PRIVACY_SETTINGS,
  ageOnDate,
  applyRelationshipPolicy,
  deriveAgeBand,
  evaluateBaselinePolicy,
} = require('../dist/trust/trustPolicy');

const { validateEventPayload, registeredEventTypes } = require('../dist/platform/events/eventRegistry');
const { trustFoundationMigration } = require('../dist/platform/migrations/0003TrustFoundation');

const AS_OF = new Date('2026-08-01T12:00:00.000Z');

function acceptedProfile(overrides = {}) {
  return {
    userId: 'subject-1',
    dateOfBirth: '2000-01-01',
    ageBand: '18_plus',
    jurisdiction: 'GB',
    consentStatus: 'accepted',
    acceptedPolicyVersion: '2026.08',
    acceptanceSource: 'mobile',
    acceptedAt: '2026-08-01T12:00:00.000Z',
    withdrawnAt: null,
    version: 1,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

function privacy(overrides = {}) {
  return {
    userId: 'subject-1',
    ...DEFAULT_PRIVACY_SETTINGS,
    version: 1,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

test('age derivation is deterministic at every policy boundary', () => {
  assert.equal(ageOnDate('2013-08-02', AS_OF), 12);
  assert.equal(deriveAgeBand('2013-08-02', AS_OF), 'under_13');
  assert.equal(deriveAgeBand('2013-08-01', AS_OF), '13_15');
  assert.equal(deriveAgeBand('2010-08-01', AS_OF), '16_17');
  assert.equal(deriveAgeBand('2008-08-01', AS_OF), '18_plus');
});

test('age derivation rejects impossible, future, and implausibly old dates', () => {
  assert.throws(() => deriveAgeBand('2026-02-30', AS_OF), /valid calendar date/);
  assert.throws(() => deriveAgeBand('2026-08-02', AS_OF), /outside the accepted age range/);
  assert.throws(() => deriveAgeBand('1800-01-01', AS_OF), /outside the accepted age range/);
});

test('baseline policy fails closed without consent or privacy state', () => {
  assert.deepEqual(evaluateBaselinePolicy({ capability: 'contact', profile: null, privacy: null }), {
    allowed: false,
    capability: 'contact',
    reasons: ['CONSENT_PROFILE_MISSING', 'PRIVACY_SETTINGS_MISSING'],
    policyProfileVersion: null,
    privacyVersion: null,
  });
});

test('baseline policy enforces consent, minimum age band, and privacy', () => {
  const withdrawn = evaluateBaselinePolicy({
    capability: 'join',
    profile: acceptedProfile({ consentStatus: 'withdrawn', withdrawnAt: '2026-08-01T13:00:00.000Z' }),
    privacy: privacy(),
  });
  assert.equal(withdrawn.allowed, false);
  assert.ok(withdrawn.reasons.includes('CONSENT_NOT_ACCEPTED'));

  const ageDenied = evaluateBaselinePolicy({
    capability: 'transact',
    profile: acceptedProfile({ ageBand: '16_17' }),
    privacy: privacy(),
    minimumAgeBand: '18_plus',
  });
  assert.equal(ageDenied.allowed, false);
  assert.ok(ageDenied.reasons.includes('AGE_BAND_INELIGIBLE'));

  const privacyDenied = evaluateBaselinePolicy({
    capability: 'contact',
    profile: acceptedProfile(),
    privacy: privacy(),
  });
  assert.equal(privacyDenied.allowed, false);
  assert.ok(privacyDenied.reasons.includes('CONTACT_DISABLED_BY_PRIVACY'));
});

test('baseline policy permits an explicitly eligible capability', () => {
  const decision = evaluateBaselinePolicy({
    capability: 'contact',
    profile: acceptedProfile(),
    privacy: privacy({ messagePermission: 'everyone' }),
    minimumAgeBand: '16_17',
  });
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.reasons, []);
});

test('a block in either direction denies every capability', () => {
  const baseline = evaluateBaselinePolicy({
    capability: 'contact',
    profile: acceptedProfile(),
    privacy: privacy({ messagePermission: 'everyone' }),
  });
  for (const signals of [
    { actorBlockedTarget: true, targetBlockedActor: false },
    { actorBlockedTarget: false, targetBlockedActor: true },
  ]) {
    const decision = applyRelationshipPolicy(baseline, {
      targetConsentActive: true,
      actorMutedTarget: false,
      targetMutedActor: false,
      ...signals,
    });
    assert.equal(decision.allowed, false);
    assert.ok(decision.reasons.includes('BLOCKED_RELATIONSHIP'));
  }
});

test('mute enforcement is capability-specific and target consent remains fail-closed', () => {
  const contact = evaluateBaselinePolicy({
    capability: 'contact',
    profile: acceptedProfile(),
    privacy: privacy({ messagePermission: 'everyone' }),
  });
  const targetMuted = applyRelationshipPolicy(contact, {
    targetConsentActive: true,
    actorBlockedTarget: false,
    targetBlockedActor: false,
    actorMutedTarget: false,
    targetMutedActor: true,
  });
  assert.equal(targetMuted.allowed, false);
  assert.ok(targetMuted.reasons.includes('MUTED_BY_TARGET'));

  const view = evaluateBaselinePolicy({
    capability: 'view',
    profile: acceptedProfile(),
    privacy: privacy({ accountVisibility: 'public', contentVisibility: 'public' }),
  });
  const actorMuted = applyRelationshipPolicy(view, {
    targetConsentActive: false,
    actorBlockedTarget: false,
    targetBlockedActor: false,
    actorMutedTarget: true,
    targetMutedActor: false,
  });
  assert.equal(actorMuted.allowed, false);
  assert.ok(actorMuted.reasons.includes('MUTED_BY_ACTOR'));
  assert.ok(actorMuted.reasons.includes('TARGET_CONSENT_INACTIVE'));
});

test('the Trust migration is ordered, transactional, irreversible, and rollout-disabled by design', () => {
  assert.equal(trustFoundationMigration.id, '0003_trust_foundation');
  assert.equal(trustFoundationMigration.transactional, true);
  assert.equal(trustFoundationMigration.reversible, false);
  assert.equal(typeof trustFoundationMigration.up, 'function');
});

test('all versioned Trust event payloads accept valid data and reject unsafe shapes', () => {
  const types = registeredEventTypes();
  for (const type of [
    'trust.consent.changed.v1',
    'trust.privacy.changed.v1',
    'trust.relationship.changed.v1',
  ]) {
    assert.ok(types.includes(type));
  }

  assert.deepEqual(
    validateEventPayload('trust.relationship.changed.v1', {
      actorUserId: 'actor-1',
      targetUserId: 'target-1',
      controlType: 'mute',
      action: 'added',
      reasonCode: 'user_choice',
      expiresAt: '2026-08-02T12:00:00.000Z',
      controlVersion: 1,
    }),
    {
      actorUserId: 'actor-1',
      targetUserId: 'target-1',
      controlType: 'mute',
      action: 'added',
      reasonCode: 'user_choice',
      expiresAt: '2026-08-02T12:00:00.000Z',
      controlVersion: 1,
    }
  );

  assert.throws(
    () =>
      validateEventPayload('trust.relationship.changed.v1', {
        actorUserId: 'actor-1',
        targetUserId: 'target-1',
        controlType: 'block',
        action: 'added',
        reasonCode: null,
        expiresAt: '2026-08-02T12:00:00.000Z',
        controlVersion: 0,
      }),
    (error) => error && error.code === 'EVENT_PAYLOAD_INVALID'
  );
});
