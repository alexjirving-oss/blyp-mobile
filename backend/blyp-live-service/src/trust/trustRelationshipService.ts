import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getEconomyInfra } from '../economy/infra';
import { ApiError } from '../platform/apiContract';
import { enqueueDomainEvent } from '../platform/events/outbox';
import {
  applyRelationshipPolicy,
  evaluateBaselinePolicy,
  type TrustDecision,
  type TrustPolicyProfile,
  type TrustPrivacySettings,
} from './trustPolicy';
import type { PolicyDecisionInput, RelationshipControlInput } from './trustSchemas';

export type RelationshipControlType = 'block' | 'mute';

export type RelationshipControl = {
  targetUserId: string;
  controlType: RelationshipControlType;
  reasonCode: string | null;
  expiresAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type EvaluatedTrustDecision = TrustDecision & {
  actorUserId: string;
  targetUserId: string;
  relationship: {
    actorBlockedTarget: boolean;
    targetBlockedActor: boolean;
    actorMutedTarget: boolean;
    targetMutedActor: boolean;
  };
};

function asIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function assertSubject(value: string, field: string): string {
  const subject = String(value || '').trim();
  if (!subject || subject.length > 256) {
    throw new ApiError(400, 'SUBJECT_INVALID', `${field} is invalid.`);
  }
  return subject;
}

function assertDifferentSubjects(actorUserId: string, targetUserId: string): void {
  if (actorUserId === targetUserId) {
    throw new ApiError(400, 'RELATIONSHIP_SELF_TARGET', 'A user cannot block or mute their own account.');
  }
}

function mapControl(row: any): RelationshipControl {
  return {
    targetUserId: String(row.target_user_id),
    controlType: row.control_type,
    reasonCode: row.reason_code ? String(row.reason_code) : null,
    expiresAt: asIso(row.expires_at),
    version: Number(row.version),
    createdAt: asIso(row.created_at)!,
    updatedAt: asIso(row.updated_at)!,
  };
}

function mapPolicyProfile(row: any): TrustPolicyProfile | null {
  if (!row) return null;
  return {
    userId: String(row.user_id),
    dateOfBirth: String(row.date_of_birth).slice(0, 10),
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

function mapPrivacy(row: any): TrustPrivacySettings | null {
  if (!row) return null;
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

async function lockRelationship(
  trx: Knex.Transaction,
  actorUserId: string,
  targetUserId: string,
  controlType: RelationshipControlType
): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
    `trust-relationship:${actorUserId}:${targetUserId}:${controlType}`,
  ]);
}

function normalizedExpiry(input: RelationshipControlInput): string | null {
  if (!input.expiresAt) return null;
  const expiresAt = new Date(input.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new ApiError(400, 'MUTE_EXPIRY_INVALID', 'expiresAt must be a future timestamp.');
  }
  const maximum = Date.now() + 366 * 24 * 60 * 60 * 1000;
  if (expiresAt.getTime() > maximum) {
    throw new ApiError(400, 'MUTE_EXPIRY_TOO_DISTANT', 'expiresAt cannot be more than 366 days ahead.');
  }
  return expiresAt.toISOString();
}

export async function setRelationshipControl(
  actorUserId: string,
  input: RelationshipControlInput,
  correlationId: string
): Promise<RelationshipControl> {
  actorUserId = assertSubject(actorUserId, 'actorUserId');
  const targetUserId = assertSubject(input.targetUserId, 'targetUserId');
  assertDifferentSubjects(actorUserId, targetUserId);
  const expiresAt = normalizedExpiry(input);
  const { db } = getEconomyInfra();

  return db.transaction(async (trx) => {
    await lockRelationship(trx, actorUserId, targetUserId, input.controlType);
    const existing = await trx('trust_relationship_controls')
      .where({
        actor_user_id: actorUserId,
        target_user_id: targetUserId,
        control_type: input.controlType,
      })
      .forUpdate()
      .first();
    const version = existing ? Number(existing.version) + 1 : 1;

    await trx('trust_relationship_controls')
      .insert({
        actor_user_id: actorUserId,
        target_user_id: targetUserId,
        control_type: input.controlType,
        reason_code: input.reasonCode ?? null,
        expires_at: expiresAt,
        version,
        updated_at: trx.fn.now(),
      })
      .onConflict(['actor_user_id', 'target_user_id', 'control_type'])
      .merge({
        reason_code: input.reasonCode ?? null,
        expires_at: expiresAt,
        version,
        updated_at: trx.fn.now(),
      });

    await trx('trust_relationship_history').insert({
      relationship_event_id: randomUUID(),
      actor_user_id: actorUserId,
      target_user_id: targetUserId,
      control_type: input.controlType,
      action: 'added',
      reason_code: input.reasonCode ?? null,
      expires_at: expiresAt,
      control_version: version,
      correlation_id: correlationId,
    });

    await enqueueDomainEvent(trx, {
      eventType: 'trust.relationship.changed.v1',
      eventVersion: 1,
      aggregate: { type: 'trust_relationship', id: `${actorUserId}:${targetUserId}` },
      actorUserId,
      correlationId,
      payload: {
        actorUserId,
        targetUserId,
        controlType: input.controlType,
        action: 'added',
        reasonCode: input.reasonCode ?? null,
        expiresAt,
        controlVersion: version,
      },
    });

    const row = await trx('trust_relationship_controls')
      .where({
        actor_user_id: actorUserId,
        target_user_id: targetUserId,
        control_type: input.controlType,
      })
      .first();
    if (!row) throw new ApiError(500, 'TRUST_STATE_INVALID', 'Relationship control was not persisted.');
    return mapControl(row);
  });
}

export async function removeRelationshipControl(
  actorUserId: string,
  targetUserId: string,
  controlType: RelationshipControlType,
  correlationId: string
): Promise<{ removed: boolean; targetUserId: string; controlType: RelationshipControlType }> {
  actorUserId = assertSubject(actorUserId, 'actorUserId');
  targetUserId = assertSubject(targetUserId, 'targetUserId');
  assertDifferentSubjects(actorUserId, targetUserId);
  const { db } = getEconomyInfra();

  return db.transaction(async (trx) => {
    await lockRelationship(trx, actorUserId, targetUserId, controlType);
    const existing = await trx('trust_relationship_controls')
      .where({ actor_user_id: actorUserId, target_user_id: targetUserId, control_type: controlType })
      .forUpdate()
      .first();
    if (!existing) return { removed: false, targetUserId, controlType };

    const version = Number(existing.version) + 1;
    await trx('trust_relationship_controls')
      .where({ actor_user_id: actorUserId, target_user_id: targetUserId, control_type: controlType })
      .delete();
    await trx('trust_relationship_history').insert({
      relationship_event_id: randomUUID(),
      actor_user_id: actorUserId,
      target_user_id: targetUserId,
      control_type: controlType,
      action: 'removed',
      reason_code: existing.reason_code ?? null,
      expires_at: existing.expires_at ?? null,
      control_version: version,
      correlation_id: correlationId,
    });
    await enqueueDomainEvent(trx, {
      eventType: 'trust.relationship.changed.v1',
      eventVersion: 1,
      aggregate: { type: 'trust_relationship', id: `${actorUserId}:${targetUserId}` },
      actorUserId,
      correlationId,
      payload: {
        actorUserId,
        targetUserId,
        controlType,
        action: 'removed',
        reasonCode: existing.reason_code ?? null,
        expiresAt: asIso(existing.expires_at),
        controlVersion: version,
      },
    });
    return { removed: true, targetUserId, controlType };
  });
}

export async function listRelationshipControls(
  actorUserId: string,
  controlType?: RelationshipControlType
): Promise<RelationshipControl[]> {
  actorUserId = assertSubject(actorUserId, 'actorUserId');
  const { db } = getEconomyInfra();
  const query = db('trust_relationship_controls')
    .where({ actor_user_id: actorUserId })
    .andWhere((builder) => builder.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now()))
    .orderBy('updated_at', 'desc');
  if (controlType) query.andWhere({ control_type: controlType });
  const rows = await query;
  return rows.map(mapControl);
}

async function activeRelationshipRows(
  db: Knex | Knex.Transaction,
  actorUserId: string,
  targetUserId: string
): Promise<any[]> {
  return db('trust_relationship_controls')
    .where((builder) =>
      builder
        .where({ actor_user_id: actorUserId, target_user_id: targetUserId })
        .orWhere({ actor_user_id: targetUserId, target_user_id: actorUserId })
    )
    .andWhere((builder) => builder.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now()));
}

async function evaluateTrustPolicyWithConnection(
  db: Knex | Knex.Transaction,
  actorUserId: string,
  input: PolicyDecisionInput
): Promise<EvaluatedTrustDecision> {
  actorUserId = assertSubject(actorUserId, 'actorUserId');
  const targetUserId = assertSubject(input.targetUserId, 'targetUserId');

  const [actorProfileRow, targetProfileRow, targetPrivacyRow, relationships] = await Promise.all([
    db('trust_policy_profiles').where({ user_id: actorUserId }).first(),
    db('trust_policy_profiles').where({ user_id: targetUserId }).first(),
    db('trust_privacy_settings').where({ user_id: targetUserId }).first(),
    activeRelationshipRows(db, actorUserId, targetUserId),
  ]);

  const actorProfile = mapPolicyProfile(actorProfileRow);
  const targetProfile = mapPolicyProfile(targetProfileRow);
  const targetPrivacy = mapPrivacy(targetPrivacyRow);
  const baseline = evaluateBaselinePolicy({
    capability: input.capability,
    profile: actorProfile,
    privacy: targetPrivacy,
    minimumAgeBand: input.minimumAgeBand,
  });

  const actorBlockedTarget = relationships.some(
    (row) => row.control_type === 'block' && row.actor_user_id === actorUserId
  );
  const targetBlockedActor = relationships.some(
    (row) => row.control_type === 'block' && row.actor_user_id === targetUserId
  );
  const actorMutedTarget = relationships.some(
    (row) => row.control_type === 'mute' && row.actor_user_id === actorUserId
  );
  const targetMutedActor = relationships.some(
    (row) => row.control_type === 'mute' && row.actor_user_id === targetUserId
  );

  const relationship = {
    actorBlockedTarget,
    targetBlockedActor,
    actorMutedTarget,
    targetMutedActor,
  };
  const decision = applyRelationshipPolicy(baseline, {
    targetConsentActive: targetProfile?.consentStatus === 'accepted',
    ...relationship,
  });

  return {
    ...decision,
    actorUserId,
    targetUserId,
    relationship,
  };
}

function trustDecisionLockKeys(actorUserId: string, targetUserId: string): string[] {
  return [...new Set([
    `trust:${actorUserId}`,
    `trust:${targetUserId}`,
    `trust-relationship:${actorUserId}:${targetUserId}:block`,
    `trust-relationship:${targetUserId}:${actorUserId}:block`,
    `trust-relationship:${actorUserId}:${targetUserId}:mute`,
    `trust-relationship:${targetUserId}:${actorUserId}:mute`,
  ])].sort();
}

async function lockTrustDecision(
  trx: Knex.Transaction,
  actorUserId: string,
  targetUserId: string
): Promise<void> {
  for (const lockKey of trustDecisionLockKeys(actorUserId, targetUserId)) {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [lockKey]);
  }
}

function assertAllowedTrustDecision(decision: EvaluatedTrustDecision): EvaluatedTrustDecision {
  if (!decision.allowed) {
    throw new ApiError(403, 'TRUST_POLICY_DENIED', 'The requested action is not permitted by Trust policy.', {
      capability: decision.capability,
      targetUserId: decision.targetUserId,
      reasons: decision.reasons,
      policyProfileVersion: decision.policyProfileVersion,
      privacyVersion: decision.privacyVersion,
      relationship: decision.relationship,
    });
  }
  return decision;
}

export async function evaluateTrustPolicy(
  actorUserId: string,
  input: PolicyDecisionInput
): Promise<EvaluatedTrustDecision> {
  const { db } = getEconomyInfra();
  return evaluateTrustPolicyWithConnection(db, actorUserId, input);
}

export async function evaluateTrustPolicyInTransaction(
  trx: Knex.Transaction,
  actorUserId: string,
  input: PolicyDecisionInput
): Promise<EvaluatedTrustDecision> {
  actorUserId = assertSubject(actorUserId, 'actorUserId');
  const targetUserId = assertSubject(input.targetUserId, 'targetUserId');
  await lockTrustDecision(trx, actorUserId, targetUserId);
  return evaluateTrustPolicyWithConnection(trx, actorUserId, { ...input, targetUserId });
}

export async function requireTrustPolicy(
  actorUserId: string,
  input: PolicyDecisionInput
): Promise<EvaluatedTrustDecision> {
  return assertAllowedTrustDecision(await evaluateTrustPolicy(actorUserId, input));
}

export async function requireTrustPolicyInTransaction(
  trx: Knex.Transaction,
  actorUserId: string,
  input: PolicyDecisionInput
): Promise<EvaluatedTrustDecision> {
  return assertAllowedTrustDecision(await evaluateTrustPolicyInTransaction(trx, actorUserId, input));
}
