import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getEconomyInfra } from '../economy/infra';
import { ApiError } from '../platform/apiContract';
import { enqueueDomainEvent } from '../platform/events/outbox';
import {
  DEFAULT_PRIVACY_SETTINGS,
  deriveAgeBand,
  type TrustPolicyProfile,
  type TrustPrivacySettings,
} from './trustPolicy';
import type {
  AcceptConsentInput,
  PrivacyUpdateInput,
  WithdrawConsentInput,
} from './trustSchemas';

function asIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asDateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function assertUserId(userId: string): string {
  const normalized = String(userId || '').trim();
  if (!normalized || normalized.length > 256) {
    throw new ApiError(401, 'AUTH_SUBJECT_INVALID', 'The authenticated subject is invalid.');
  }
  return normalized;
}

function mapPolicyProfile(row: any): TrustPolicyProfile {
  return {
    userId: String(row.user_id),
    dateOfBirth: asDateOnly(row.date_of_birth),
    ageBand: row.age_band,
    jurisdiction: String(row.jurisdiction),
    consentStatus: row.consent_status,
    acceptedPolicyVersion: String(row.accepted_policy_version),
    acceptanceSource: row.acceptance_source,
    acceptedAt: asIso(row.accepted_at),
    withdrawnAt: asIso(row.withdrawn_at),
    version: Number(row.version),
    createdAt: asIso(row.created_at)!,
    updatedAt: asIso(row.updated_at)!,
  };
}

function mapPrivacySettings(row: any): TrustPrivacySettings {
  return {
    userId: String(row.user_id),
    accountVisibility: row.account_visibility,
    contentVisibility: row.content_visibility,
    messagePermission: row.message_permission,
    discoverability: row.discoverability,
    locationPrecision: row.location_precision,
    allowPersonalization: Boolean(row.allow_personalization),
    allowAnalytics: Boolean(row.allow_analytics),
    allowAiTraining: Boolean(row.allow_ai_training),
    version: Number(row.version),
    createdAt: asIso(row.created_at)!,
    updatedAt: asIso(row.updated_at)!,
  };
}

async function lockUser(trx: Knex.Transaction, userId: string): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`trust:${userId}`]);
}

async function readPolicyProfile(connection: Knex | Knex.Transaction, userId: string) {
  return connection('trust_policy_profiles').where({ user_id: userId }).first();
}

async function readPrivacySettings(connection: Knex | Knex.Transaction, userId: string) {
  return connection('trust_privacy_settings').where({ user_id: userId }).first();
}

export async function getTrustSnapshot(userId: string): Promise<{
  profile: TrustPolicyProfile | null;
  privacy: TrustPrivacySettings | null;
}> {
  userId = assertUserId(userId);
  const { db } = getEconomyInfra();
  const [profile, privacy] = await Promise.all([
    readPolicyProfile(db, userId),
    readPrivacySettings(db, userId),
  ]);
  return {
    profile: profile ? mapPolicyProfile(profile) : null,
    privacy: privacy ? mapPrivacySettings(privacy) : null,
  };
}

export async function acceptConsent(
  userId: string,
  input: AcceptConsentInput,
  correlationId: string
): Promise<{ profile: TrustPolicyProfile; privacy: TrustPrivacySettings }> {
  userId = assertUserId(userId);
  let ageBand;
  try {
    ageBand = deriveAgeBand(input.dateOfBirth);
  } catch (error) {
    throw new ApiError(
      400,
      'DATE_OF_BIRTH_INVALID',
      error instanceof Error ? error.message : 'dateOfBirth is invalid.'
    );
  }

  const { db } = getEconomyInfra();
  return db.transaction(async (trx) => {
    await lockUser(trx, userId);
    const existing = await readPolicyProfile(trx, userId);
    const version = existing ? Number(existing.version) + 1 : 1;

    await trx('trust_policy_profiles')
      .insert({
        user_id: userId,
        date_of_birth: input.dateOfBirth,
        age_band: ageBand,
        jurisdiction: input.jurisdiction,
        consent_status: 'accepted',
        accepted_policy_version: input.policyVersion,
        acceptance_source: input.acceptanceSource,
        accepted_at: trx.fn.now(),
        withdrawn_at: null,
        version,
        updated_at: trx.fn.now(),
      })
      .onConflict('user_id')
      .merge({
        date_of_birth: input.dateOfBirth,
        age_band: ageBand,
        jurisdiction: input.jurisdiction,
        consent_status: 'accepted',
        accepted_policy_version: input.policyVersion,
        acceptance_source: input.acceptanceSource,
        accepted_at: trx.fn.now(),
        withdrawn_at: null,
        version,
        updated_at: trx.fn.now(),
      });

    await trx('trust_privacy_settings')
      .insert({
        user_id: userId,
        account_visibility: DEFAULT_PRIVACY_SETTINGS.accountVisibility,
        content_visibility: DEFAULT_PRIVACY_SETTINGS.contentVisibility,
        message_permission: DEFAULT_PRIVACY_SETTINGS.messagePermission,
        discoverability: DEFAULT_PRIVACY_SETTINGS.discoverability,
        location_precision: DEFAULT_PRIVACY_SETTINGS.locationPrecision,
        allow_personalization: DEFAULT_PRIVACY_SETTINGS.allowPersonalization,
        allow_analytics: DEFAULT_PRIVACY_SETTINGS.allowAnalytics,
        allow_ai_training: DEFAULT_PRIVACY_SETTINGS.allowAiTraining,
      })
      .onConflict('user_id')
      .ignore();

    await trx('trust_consent_history').insert({
      consent_event_id: randomUUID(),
      user_id: userId,
      consent_status: 'accepted',
      policy_version: input.policyVersion,
      date_of_birth: input.dateOfBirth,
      age_band: ageBand,
      jurisdiction: input.jurisdiction,
      acceptance_source: input.acceptanceSource,
      profile_version: version,
      correlation_id: correlationId,
    });

    await enqueueDomainEvent(trx, {
      eventType: 'trust.consent.changed.v1',
      eventVersion: 1,
      aggregate: { type: 'trust_profile', id: userId },
      actorUserId: userId,
      correlationId,
      payload: {
        userId,
        consentStatus: 'accepted',
        policyVersion: input.policyVersion,
        ageBand,
        jurisdiction: input.jurisdiction,
        profileVersion: version,
      },
    });

    const [profile, privacy] = await Promise.all([
      readPolicyProfile(trx, userId),
      readPrivacySettings(trx, userId),
    ]);
    if (!profile || !privacy) throw new ApiError(500, 'TRUST_STATE_INVALID', 'Trust state was not persisted.');
    return { profile: mapPolicyProfile(profile), privacy: mapPrivacySettings(privacy) };
  });
}

export async function withdrawConsent(
  userId: string,
  input: WithdrawConsentInput,
  correlationId: string
): Promise<TrustPolicyProfile> {
  userId = assertUserId(userId);
  const { db } = getEconomyInfra();
  return db.transaction(async (trx) => {
    await lockUser(trx, userId);
    const existing = await readPolicyProfile(trx, userId);
    if (!existing) {
      throw new ApiError(404, 'CONSENT_PROFILE_NOT_FOUND', 'No consent profile exists for this account.');
    }
    const version = Number(existing.version) + 1;

    await trx('trust_policy_profiles').where({ user_id: userId }).update({
      consent_status: 'withdrawn',
      accepted_policy_version: input.policyVersion,
      acceptance_source: input.acceptanceSource,
      withdrawn_at: trx.fn.now(),
      version,
      updated_at: trx.fn.now(),
    });

    await trx('trust_consent_history').insert({
      consent_event_id: randomUUID(),
      user_id: userId,
      consent_status: 'withdrawn',
      policy_version: input.policyVersion,
      date_of_birth: existing.date_of_birth,
      age_band: existing.age_band,
      jurisdiction: existing.jurisdiction,
      acceptance_source: input.acceptanceSource,
      profile_version: version,
      correlation_id: correlationId,
    });

    await enqueueDomainEvent(trx, {
      eventType: 'trust.consent.changed.v1',
      eventVersion: 1,
      aggregate: { type: 'trust_profile', id: userId },
      actorUserId: userId,
      correlationId,
      payload: {
        userId,
        consentStatus: 'withdrawn',
        policyVersion: input.policyVersion,
        ageBand: existing.age_band,
        jurisdiction: existing.jurisdiction,
        profileVersion: version,
      },
    });

    const profile = await readPolicyProfile(trx, userId);
    if (!profile) throw new ApiError(500, 'TRUST_STATE_INVALID', 'Trust state was not persisted.');
    return mapPolicyProfile(profile);
  });
}

const PRIVACY_COLUMN_BY_FIELD: Record<keyof PrivacyUpdateInput, string> = {
  accountVisibility: 'account_visibility',
  contentVisibility: 'content_visibility',
  messagePermission: 'message_permission',
  discoverability: 'discoverability',
  locationPrecision: 'location_precision',
  allowPersonalization: 'allow_personalization',
  allowAnalytics: 'allow_analytics',
  allowAiTraining: 'allow_ai_training',
};

export async function updatePrivacySettings(
  userId: string,
  input: PrivacyUpdateInput,
  correlationId: string
): Promise<TrustPrivacySettings> {
  userId = assertUserId(userId);
  const changedFields = (Object.keys(input) as (keyof PrivacyUpdateInput)[]).sort();
  const { db } = getEconomyInfra();

  return db.transaction(async (trx) => {
    await lockUser(trx, userId);
    const profile = await readPolicyProfile(trx, userId);
    if (!profile || profile.consent_status !== 'accepted') {
      throw new ApiError(409, 'CONSENT_REQUIRED', 'Accepted consent is required before privacy settings can be changed.');
    }

    await trx('trust_privacy_settings')
      .insert({
        user_id: userId,
        account_visibility: DEFAULT_PRIVACY_SETTINGS.accountVisibility,
        content_visibility: DEFAULT_PRIVACY_SETTINGS.contentVisibility,
        message_permission: DEFAULT_PRIVACY_SETTINGS.messagePermission,
        discoverability: DEFAULT_PRIVACY_SETTINGS.discoverability,
        location_precision: DEFAULT_PRIVACY_SETTINGS.locationPrecision,
        allow_personalization: DEFAULT_PRIVACY_SETTINGS.allowPersonalization,
        allow_analytics: DEFAULT_PRIVACY_SETTINGS.allowAnalytics,
        allow_ai_training: DEFAULT_PRIVACY_SETTINGS.allowAiTraining,
      })
      .onConflict('user_id')
      .ignore();

    const existing = await readPrivacySettings(trx, userId);
    if (!existing) throw new ApiError(500, 'TRUST_STATE_INVALID', 'Privacy state could not be initialized.');
    const version = Number(existing.version) + 1;
    const update: Record<string, unknown> = { version, updated_at: trx.fn.now() };
    for (const field of changedFields) update[PRIVACY_COLUMN_BY_FIELD[field]] = input[field];

    await trx('trust_privacy_settings').where({ user_id: userId }).update(update);
    const settings = await readPrivacySettings(trx, userId);
    if (!settings) throw new ApiError(500, 'TRUST_STATE_INVALID', 'Privacy state was not persisted.');
    const mapped = mapPrivacySettings(settings);

    await trx('trust_privacy_history').insert({
      privacy_event_id: randomUUID(),
      user_id: userId,
      settings: JSON.stringify(mapped),
      settings_version: version,
      correlation_id: correlationId,
    });

    await enqueueDomainEvent(trx, {
      eventType: 'trust.privacy.changed.v1',
      eventVersion: 1,
      aggregate: { type: 'trust_privacy', id: userId },
      actorUserId: userId,
      correlationId,
      payload: { userId, settingsVersion: version, changedFields },
    });

    return mapped;
  });
}
