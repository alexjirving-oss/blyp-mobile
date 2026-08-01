import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getEconomyInfra } from './infra';
import type { QuotaReserveInput, QuotaResolutionInput } from './economySchemas';
import { ApiError } from '../platform/apiContract';
import { enqueueDomainEvent } from '../platform/events/outbox';
import { requireTrustPolicyInTransaction } from '../trust/trustRelationshipService';
import {
  availableQuotaUnits,
  commitQuotaUnits,
  effectiveAllowanceUnits,
  releaseQuotaUnits,
  reservationHasExpired,
  reserveQuotaUnits,
} from './quotaPolicy';

const FREE_PLAN_ID = 'FREE';
const PREMIUM_PLAN_ID = 'PREMIUM';

type DatabaseConnection = Knex | Knex.Transaction;
type PlanTier = 'FREE' | 'PREMIUM';
type ReservationStatus = 'RESERVED' | 'COMMITTED' | 'REFUNDED' | 'EXPIRED';

type ResolvedPlan = {
  planId: string;
  planTier: PlanTier;
  planName: string;
  source: 'FREE_DEFAULT' | 'VERIFIED_SUBSCRIPTION';
  subscription: null | {
    subscriptionId: string;
    status: string;
    provider: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    verifiedAt: string;
    version: number;
  };
};

type EntitlementDefinitionRow = {
  plan_id: string;
  entitlement_key: string;
  unit_name: string;
  period_kind: 'UTC_DAY';
  allowance_units: number | string;
  reservation_ttl_seconds: number | string;
  enabled: boolean;
  configuration: Record<string, unknown> | string | null;
};

type QuotaPeriodRow = {
  quota_period_id: string;
  user_id: string;
  entitlement_key: string;
  plan_id: string;
  period_start: Date | string;
  period_end: Date | string;
  allowance_units: number | string;
  reserved_units: number | string;
  committed_units: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

type QuotaReservationRow = {
  reservation_id: string;
  user_id: string;
  entitlement_key: string;
  plan_id: string;
  quota_period_id: string;
  requested_units: number | string;
  status: ReservationStatus;
  expires_at: Date | string;
  idempotency_key: string;
  commit_idempotency_key: string | null;
  refund_idempotency_key: string | null;
  correlation_id: string;
  reserved_at: Date | string;
  committed_at: Date | string | null;
  refunded_at: Date | string | null;
  expired_at: Date | string | null;
  updated_at: Date | string;
};

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asNullableIso(value: Date | string | null | undefined): string | null {
  return value === null || value === undefined ? null : asIso(value);
}

function asInt(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ApiError(500, 'QUOTA_STATE_INVALID', 'Quota counters are invalid.');
  }
  return parsed;
}

function asObject(value: EntitlementDefinitionRow['configuration']): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function assertSubject(value: string): string {
  const userId = String(value || '').trim();
  if (!userId || userId.length > 256) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'A canonical authenticated user is required.');
  }
  return userId;
}

export function utcDayWindow(now: Date = new Date()): { periodStart: string; periodEnd: string } {
  if (!Number.isFinite(now.getTime())) {
    throw new ApiError(500, 'CLOCK_INVALID', 'The quota clock is invalid.');
  }
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 1);
  return { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() };
}

function quotaSnapshot(period: QuotaPeriodRow) {
  const allowanceUnits = asInt(period.allowance_units);
  const reservedUnits = asInt(period.reserved_units);
  const committedUnits = asInt(period.committed_units);
  const availableUnits = availableQuotaUnits({ allowanceUnits, reservedUnits, committedUnits });
  return {
    quotaPeriodId: String(period.quota_period_id),
    planId: String(period.plan_id),
    periodStart: asIso(period.period_start),
    periodEnd: asIso(period.period_end),
    allowanceUnits,
    reservedUnits,
    committedUnits,
    availableUnits,
  };
}

function reservationSnapshot(reservation: QuotaReservationRow, period: QuotaPeriodRow) {
  return {
    reservation: {
      reservationId: String(reservation.reservation_id),
      entitlementKey: String(reservation.entitlement_key),
      planId: String(reservation.plan_id),
      units: asInt(reservation.requested_units),
      status: reservation.status,
      expiresAt: asIso(reservation.expires_at),
      reservedAt: asIso(reservation.reserved_at),
      committedAt: asNullableIso(reservation.committed_at),
      refundedAt: asNullableIso(reservation.refunded_at),
      expiredAt: asNullableIso(reservation.expired_at),
    },
    quota: quotaSnapshot(period),
  };
}

async function resolvePlan(
  connection: DatabaseConnection,
  userId: string,
  now: Date,
  lockSubscription = false
): Promise<ResolvedPlan> {
  let subscriptionQuery = connection('user_subscriptions')
    .where({ user_id: userId })
    .whereIn('status', ['active', 'trialing'])
    .whereIn('provider_status', ['active', 'trialing'])
    .whereNotNull('provider_verified_at')
    .whereNotNull('current_period_start')
    .whereNotNull('current_period_end')
    .andWhere('current_period_start', '<=', now.toISOString())
    .andWhere('current_period_end', '>', now.toISOString())
    .orderBy('current_period_end', 'desc');
  if (lockSubscription && 'forUpdate' in subscriptionQuery) subscriptionQuery = subscriptionQuery.forUpdate();
  const subscription = await subscriptionQuery.first();

  if (subscription) {
    const plan = await connection('subscription_plans')
      .where({ plan_id: subscription.plan_id, enabled: true, plan_tier: PREMIUM_PLAN_ID })
      .first();
    if (plan) {
      return {
        planId: String(plan.plan_id),
        planTier: 'PREMIUM',
        planName: String(plan.plan_name),
        source: 'VERIFIED_SUBSCRIPTION',
        subscription: {
          subscriptionId: String(subscription.subscription_id),
          status: String(subscription.status),
          provider: String(subscription.provider),
          currentPeriodStart: asIso(subscription.current_period_start),
          currentPeriodEnd: asIso(subscription.current_period_end),
          cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
          verifiedAt: asIso(subscription.provider_verified_at),
          version: asInt(subscription.version),
        },
      };
    }
  }

  const freePlan = await connection('subscription_plans')
    .where({ plan_id: FREE_PLAN_ID, enabled: true, plan_tier: FREE_PLAN_ID })
    .first();
  if (!freePlan) {
    throw new ApiError(
      503,
      'ENTITLEMENT_CONFIGURATION_UNAVAILABLE',
      'Entitlement configuration is unavailable.'
    );
  }
  return {
    planId: String(freePlan.plan_id),
    planTier: 'FREE',
    planName: String(freePlan.plan_name),
    source: 'FREE_DEFAULT',
    subscription: null,
  };
}

async function lockQuotaKey(
  trx: Knex.Transaction,
  userId: string,
  entitlementKey: string,
  periodStart: string
): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
    `economy-quota:${userId}:${entitlementKey}:${periodStart}`,
  ]);
}

async function lockQuotaIdempotency(
  trx: Knex.Transaction,
  userId: string,
  idempotencyKey: string
): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
    `economy-quota-idempotency:${userId}:${idempotencyKey}`,
  ]);
}

async function ensureQuotaPeriod(
  trx: Knex.Transaction,
  userId: string,
  definition: EntitlementDefinitionRow,
  window: { periodStart: string; periodEnd: string }
): Promise<QuotaPeriodRow> {
  await lockQuotaKey(trx, userId, definition.entitlement_key, window.periodStart);
  let period = (await trx<QuotaPeriodRow>('quota_periods')
    .where({
      user_id: userId,
      entitlement_key: definition.entitlement_key,
      period_start: window.periodStart,
    })
    .forUpdate()
    .first()) as QuotaPeriodRow | undefined;

  if (!period) {
    const quotaPeriodId = randomUUID();
    await trx('quota_periods').insert({
      quota_period_id: quotaPeriodId,
      user_id: userId,
      entitlement_key: definition.entitlement_key,
      plan_id: definition.plan_id,
      period_start: window.periodStart,
      period_end: window.periodEnd,
      allowance_units: asInt(definition.allowance_units),
      reserved_units: 0,
      committed_units: 0,
    });
    period = (await trx<QuotaPeriodRow>('quota_periods')
      .where({ quota_period_id: quotaPeriodId })
      .forUpdate()
      .first()) as QuotaPeriodRow | undefined;
  }

  if (!period) {
    throw new ApiError(500, 'QUOTA_STATE_INVALID', 'The quota period was not persisted.');
  }

  // Upgrades can increase the current UTC-day allowance immediately. Downgrades
  // take effect at the next rollover and never invalidate already granted units.
  const configuredAllowance = asInt(definition.allowance_units);
  const minimumSafeAllowance = asInt(period.reserved_units) + asInt(period.committed_units);
  const nextAllowance = effectiveAllowanceUnits(
    asInt(period.allowance_units),
    configuredAllowance,
    asInt(period.reserved_units),
    asInt(period.committed_units)
  );
  if (nextAllowance !== asInt(period.allowance_units) || period.plan_id !== definition.plan_id) {
    await trx('quota_periods')
      .where({ quota_period_id: period.quota_period_id })
      .update({
        plan_id: definition.plan_id,
        allowance_units: nextAllowance,
        updated_at: trx.fn.now(),
      });
    period = (await trx<QuotaPeriodRow>('quota_periods')
      .where({ quota_period_id: period.quota_period_id })
      .forUpdate()
      .first()) as QuotaPeriodRow;
  }
  return period;
}

async function emitQuotaEvent(
  trx: Knex.Transaction,
  eventType:
    | 'economy.quota.reserved.v1'
    | 'economy.quota.committed.v1'
    | 'economy.quota.refunded.v1'
    | 'economy.quota.expired.v1',
  reservation: QuotaReservationRow,
  period: QuotaPeriodRow,
  correlationId: string
): Promise<void> {
  const snapshot = quotaSnapshot(period);
  await enqueueDomainEvent(trx, {
    eventType,
    eventVersion: 1,
    aggregate: { type: 'quota_reservation', id: reservation.reservation_id },
    actorUserId: reservation.user_id,
    correlationId,
    payload: {
      userId: reservation.user_id,
      entitlementKey: reservation.entitlement_key,
      planId: reservation.plan_id,
      reservationId: reservation.reservation_id,
      quotaPeriodId: reservation.quota_period_id,
      units: asInt(reservation.requested_units),
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
      remainingUnits: snapshot.availableUnits,
    },
  });
}

async function expireReservationsForPeriod(
  trx: Knex.Transaction,
  period: QuotaPeriodRow,
  now: Date,
  correlationId: string
): Promise<QuotaPeriodRow> {
  const expired = (await trx<QuotaReservationRow>('quota_reservations')
    .where({ quota_period_id: period.quota_period_id, status: 'RESERVED' })
    .andWhere('expires_at', '<=', now.toISOString())
    .orderBy('reservation_id', 'asc')
    .forUpdate()) as QuotaReservationRow[];
  if (expired.length === 0) return period;

  let counters = {
    allowanceUnits: asInt(period.allowance_units),
    reservedUnits: asInt(period.reserved_units),
    committedUnits: asInt(period.committed_units),
  };
  for (const row of expired) {
    const units = asInt(row.requested_units);
    counters = releaseQuotaUnits(counters, units);

    await trx('quota_reservations')
      .where({ reservation_id: row.reservation_id, status: 'RESERVED' })
      .update({ status: 'EXPIRED', expired_at: now.toISOString(), updated_at: trx.fn.now() });
    await trx('quota_usage_ledger')
      .insert({
        usage_entry_id: randomUUID(),
        user_id: row.user_id,
        entitlement_key: row.entitlement_key,
        quota_period_id: row.quota_period_id,
        reservation_id: row.reservation_id,
        entry_type: 'EXPIRE',
        units,
        idempotency_key: `expiry:${row.reservation_id}`,
        correlation_id: correlationId,
        metadata: { cause: 'reservation_ttl_elapsed' },
      })
      .onConflict(['user_id', 'idempotency_key'])
      .ignore();

    const eventReservation: QuotaReservationRow = {
      ...row,
      status: 'EXPIRED',
      expired_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    const eventPeriod: QuotaPeriodRow = { ...period, reserved_units: counters.reservedUnits };
    await emitQuotaEvent(trx, 'economy.quota.expired.v1', eventReservation, eventPeriod, correlationId);
  }

  await trx('quota_periods')
    .where({ quota_period_id: period.quota_period_id })
    .update({ reserved_units: counters.reservedUnits, updated_at: trx.fn.now() });
  const refreshed = await trx<QuotaPeriodRow>('quota_periods')
    .where({ quota_period_id: period.quota_period_id })
    .forUpdate()
    .first();
  if (!refreshed) throw new ApiError(500, 'QUOTA_STATE_INVALID', 'Quota period disappeared.');
  return refreshed as QuotaPeriodRow;
}

async function definitionForPlan(
  connection: DatabaseConnection,
  planId: string,
  entitlementKey: string
): Promise<EntitlementDefinitionRow> {
  const definition = await connection<EntitlementDefinitionRow>('entitlement_definitions')
    .where({ plan_id: planId, entitlement_key: entitlementKey, enabled: true })
    .first();
  if (!definition) {
    throw new ApiError(403, 'ENTITLEMENT_NOT_GRANTED', 'The requested entitlement is not granted.');
  }
  return definition as EntitlementDefinitionRow;
}

async function assertOperationKeyAvailable(
  trx: Knex.Transaction,
  userId: string,
  idempotencyKey: string,
  reservationId: string,
  entryType: 'COMMIT' | 'REFUND'
): Promise<void> {
  const existing = await trx('quota_usage_ledger')
    .where({ user_id: userId, idempotency_key: idempotencyKey })
    .first();
  if (!existing) return;
  if (existing.reservation_id === reservationId && existing.entry_type === entryType) return;
  throw new ApiError(
    409,
    'IDEMPOTENCY_KEY_REUSED',
    'The idempotency key was already used for another quota operation.'
  );
}

export async function getEntitlementSnapshot(
  userId: string,
  correlationId: string,
  now: Date = new Date()
) {
  userId = assertSubject(userId);
  const { db } = getEconomyInfra();
  return db.transaction(async (trx) => {
    const plan = await resolvePlan(trx, userId, now, true);
    const definitions = (await trx<EntitlementDefinitionRow>('entitlement_definitions')
      .where({ plan_id: plan.planId, enabled: true })
      .orderBy('entitlement_key', 'asc')) as EntitlementDefinitionRow[];
    const window = utcDayWindow(now);
    const entitlements = [];

    for (const definition of definitions) {
      let period = await ensureQuotaPeriod(trx, userId, definition, window);
      period = await expireReservationsForPeriod(trx, period, now, correlationId);
      const quota = quotaSnapshot(period);
      entitlements.push({
        entitlementKey: definition.entitlement_key,
        granted: true,
        unitName: definition.unit_name,
        periodKind: definition.period_kind,
        reservationTtlSeconds: asInt(definition.reservation_ttl_seconds),
        configuration: asObject(definition.configuration),
        quota,
      });
    }

    return {
      plan: {
        planId: plan.planId,
        planTier: plan.planTier,
        planName: plan.planName,
        source: plan.source,
      },
      subscription: plan.subscription,
      entitlements,
      evaluatedAt: now.toISOString(),
    };
  });
}

export async function reserveQuota(
  userId: string,
  input: QuotaReserveInput,
  correlationId: string,
  now: Date = new Date()
) {
  userId = assertSubject(userId);
  const { db } = getEconomyInfra();
  return db.transaction(async (trx) => {
    await lockQuotaIdempotency(trx, userId, input.idempotencyKey);
    const replay = (await trx<QuotaReservationRow>('quota_reservations')
      .where({ user_id: userId, idempotency_key: input.idempotencyKey })
      .first()) as QuotaReservationRow | undefined;
    if (replay) {
      if (
        replay.entitlement_key !== input.entitlementKey ||
        asInt(replay.requested_units) !== input.units
      ) {
        throw new ApiError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'The idempotency key was already used with a different quota request.'
        );
      }
      const period = await trx<QuotaPeriodRow>('quota_periods')
        .where({ quota_period_id: replay.quota_period_id })
        .first();
      if (!period) throw new ApiError(500, 'QUOTA_STATE_INVALID', 'Quota replay state is incomplete.');
      return { kind: 'replay' as const, ...reservationSnapshot(replay, period as QuotaPeriodRow) };
    }

    await requireTrustPolicyInTransaction(trx, userId, {
      targetUserId: userId,
      capability: 'transact',
    });
    const plan = await resolvePlan(trx, userId, now, true);
    const definition = await definitionForPlan(trx, plan.planId, input.entitlementKey);
    const window = utcDayWindow(now);
    let period = await ensureQuotaPeriod(trx, userId, definition, window);
    period = await expireReservationsForPeriod(trx, period, now, correlationId);
    const before = quotaSnapshot(period);
    let reservedCounters;
    try {
      reservedCounters = reserveQuotaUnits(
        {
          allowanceUnits: before.allowanceUnits,
          reservedUnits: before.reservedUnits,
          committedUnits: before.committedUnits,
        },
        input.units
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'QUOTA_EXHAUSTED') {
        throw new ApiError(409, 'QUOTA_EXHAUSTED', 'The requested quota is not available.', {
          entitlementKey: input.entitlementKey,
          requestedUnits: input.units,
          quota: before,
        });
      }
      throw error;
    }

    const reservationId = randomUUID();
    const ttlMs = asInt(definition.reservation_ttl_seconds) * 1000;
    const expiresAtMs = Math.min(now.getTime() + ttlMs, new Date(window.periodEnd).getTime());
    const expiresAt = new Date(expiresAtMs).toISOString();
    await trx('quota_reservations').insert({
      reservation_id: reservationId,
      user_id: userId,
      entitlement_key: input.entitlementKey,
      plan_id: plan.planId,
      quota_period_id: period.quota_period_id,
      requested_units: input.units,
      status: 'RESERVED',
      expires_at: expiresAt,
      idempotency_key: input.idempotencyKey,
      correlation_id: correlationId,
      metadata: { planSource: plan.source },
    });
    await trx('quota_periods')
      .where({ quota_period_id: period.quota_period_id })
      .update({
        reserved_units: reservedCounters.reservedUnits,
        updated_at: trx.fn.now(),
      });
    await trx('quota_usage_ledger').insert({
      usage_entry_id: randomUUID(),
      user_id: userId,
      entitlement_key: input.entitlementKey,
      quota_period_id: period.quota_period_id,
      reservation_id: reservationId,
      entry_type: 'RESERVE',
      units: input.units,
      idempotency_key: input.idempotencyKey,
      correlation_id: correlationId,
      metadata: { planId: plan.planId },
    });

    const reservation = await trx<QuotaReservationRow>('quota_reservations')
      .where({ reservation_id: reservationId })
      .first();
    period = (await trx<QuotaPeriodRow>('quota_periods')
      .where({ quota_period_id: period.quota_period_id })
      .forUpdate()
      .first()) as QuotaPeriodRow;
    if (!reservation || !period) {
      throw new ApiError(500, 'QUOTA_STATE_INVALID', 'The reservation was not persisted.');
    }
    await emitQuotaEvent(
      trx,
      'economy.quota.reserved.v1',
      reservation as QuotaReservationRow,
      period,
      correlationId
    );
    return { kind: 'ok' as const, ...reservationSnapshot(reservation as QuotaReservationRow, period) };
  });
}

async function lockedReservationContext(
  trx: Knex.Transaction,
  userId: string,
  reservationId: string
): Promise<{ reservation: QuotaReservationRow; period: QuotaPeriodRow }> {
  const candidate = (await trx<QuotaReservationRow>('quota_reservations')
    .where({ reservation_id: reservationId, user_id: userId })
    .first()) as QuotaReservationRow | undefined;
  if (!candidate) {
    throw new ApiError(404, 'QUOTA_RESERVATION_NOT_FOUND', 'The quota reservation was not found.');
  }
  const periodCandidate = (await trx<QuotaPeriodRow>('quota_periods')
    .where({ quota_period_id: candidate.quota_period_id })
    .first()) as QuotaPeriodRow | undefined;
  if (!periodCandidate) throw new ApiError(500, 'QUOTA_STATE_INVALID', 'Quota period is missing.');

  await lockQuotaKey(trx, userId, candidate.entitlement_key, asIso(periodCandidate.period_start));
  const period = (await trx<QuotaPeriodRow>('quota_periods')
    .where({ quota_period_id: candidate.quota_period_id })
    .forUpdate()
    .first()) as QuotaPeriodRow | undefined;
  const reservation = (await trx<QuotaReservationRow>('quota_reservations')
    .where({ reservation_id: reservationId, user_id: userId })
    .forUpdate()
    .first()) as QuotaReservationRow | undefined;
  if (!period || !reservation) {
    throw new ApiError(500, 'QUOTA_STATE_INVALID', 'Quota reservation state is incomplete.');
  }
  return { reservation, period };
}

export async function commitQuotaReservation(
  userId: string,
  reservationId: string,
  input: QuotaResolutionInput,
  correlationId: string,
  now: Date = new Date()
) {
  userId = assertSubject(userId);
  const { db } = getEconomyInfra();
  const outcome = await db.transaction(async (trx) => {
    let { reservation, period } = await lockedReservationContext(trx, userId, reservationId);
    await assertOperationKeyAvailable(trx, userId, input.idempotencyKey, reservationId, 'COMMIT');

    if (reservation.status === 'COMMITTED') {
      if (reservation.commit_idempotency_key !== input.idempotencyKey) {
        throw new ApiError(409, 'QUOTA_RESERVATION_ALREADY_COMMITTED', 'The quota reservation is committed.');
      }
      return { kind: 'replay' as const, ...reservationSnapshot(reservation, period) };
    }
    if (reservation.status === 'REFUNDED') {
      throw new ApiError(409, 'QUOTA_RESERVATION_REFUNDED', 'The quota reservation was refunded.');
    }
    if (reservation.status === 'EXPIRED') {
      return { kind: 'expired' as const, ...reservationSnapshot(reservation, period) };
    }

    if (reservationHasExpired(reservation.expires_at, now)) {
      period = await expireReservationsForPeriod(trx, period, now, correlationId);
      reservation = (await trx<QuotaReservationRow>('quota_reservations')
        .where({ reservation_id: reservationId })
        .forUpdate()
        .first()) as QuotaReservationRow;
      return { kind: 'expired' as const, ...reservationSnapshot(reservation, period) };
    }

    const units = asInt(reservation.requested_units);
    const committedCounters = commitQuotaUnits(
      {
        allowanceUnits: asInt(period.allowance_units),
        reservedUnits: asInt(period.reserved_units),
        committedUnits: asInt(period.committed_units),
      },
      units
    );
    await trx('quota_reservations')
      .where({ reservation_id: reservationId, status: 'RESERVED' })
      .update({
        status: 'COMMITTED',
        commit_idempotency_key: input.idempotencyKey,
        committed_at: now.toISOString(),
        updated_at: trx.fn.now(),
      });
    await trx('quota_periods')
      .where({ quota_period_id: period.quota_period_id })
      .update({
        reserved_units: committedCounters.reservedUnits,
        committed_units: committedCounters.committedUnits,
        updated_at: trx.fn.now(),
      });
    await trx('quota_usage_ledger').insert({
      usage_entry_id: randomUUID(),
      user_id: userId,
      entitlement_key: reservation.entitlement_key,
      quota_period_id: reservation.quota_period_id,
      reservation_id: reservationId,
      entry_type: 'COMMIT',
      units,
      idempotency_key: input.idempotencyKey,
      correlation_id: correlationId,
      metadata: {},
    });

    reservation = (await trx<QuotaReservationRow>('quota_reservations')
      .where({ reservation_id: reservationId })
      .forUpdate()
      .first()) as QuotaReservationRow;
    period = (await trx<QuotaPeriodRow>('quota_periods')
      .where({ quota_period_id: period.quota_period_id })
      .forUpdate()
      .first()) as QuotaPeriodRow;
    await emitQuotaEvent(trx, 'economy.quota.committed.v1', reservation, period, correlationId);
    return { kind: 'ok' as const, ...reservationSnapshot(reservation, period) };
  });

  if (outcome.kind === 'expired') {
    throw new ApiError(409, 'QUOTA_RESERVATION_EXPIRED', 'The quota reservation expired.', {
      reservation: outcome.reservation,
      quota: outcome.quota,
    });
  }
  return outcome;
}

export async function refundQuotaReservation(
  userId: string,
  reservationId: string,
  input: QuotaResolutionInput,
  correlationId: string,
  now: Date = new Date()
) {
  userId = assertSubject(userId);
  const { db } = getEconomyInfra();
  const outcome = await db.transaction(async (trx) => {
    let { reservation, period } = await lockedReservationContext(trx, userId, reservationId);
    await assertOperationKeyAvailable(trx, userId, input.idempotencyKey, reservationId, 'REFUND');

    if (reservation.status === 'REFUNDED') {
      if (reservation.refund_idempotency_key !== input.idempotencyKey) {
        throw new ApiError(409, 'QUOTA_RESERVATION_ALREADY_REFUNDED', 'The quota reservation is refunded.');
      }
      return { kind: 'replay' as const, ...reservationSnapshot(reservation, period) };
    }
    if (reservation.status === 'COMMITTED') {
      throw new ApiError(
        409,
        'QUOTA_RESERVATION_ALREADY_COMMITTED',
        'Committed quota cannot be refunded through the reservation endpoint.'
      );
    }
    if (reservation.status === 'EXPIRED') {
      return { kind: 'expired' as const, ...reservationSnapshot(reservation, period) };
    }

    if (reservationHasExpired(reservation.expires_at, now)) {
      period = await expireReservationsForPeriod(trx, period, now, correlationId);
      reservation = (await trx<QuotaReservationRow>('quota_reservations')
        .where({ reservation_id: reservationId })
        .forUpdate()
        .first()) as QuotaReservationRow;
      return { kind: 'expired' as const, ...reservationSnapshot(reservation, period) };
    }

    const units = asInt(reservation.requested_units);
    const refundedCounters = releaseQuotaUnits(
      {
        allowanceUnits: asInt(period.allowance_units),
        reservedUnits: asInt(period.reserved_units),
        committedUnits: asInt(period.committed_units),
      },
      units
    );
    await trx('quota_reservations')
      .where({ reservation_id: reservationId, status: 'RESERVED' })
      .update({
        status: 'REFUNDED',
        refund_idempotency_key: input.idempotencyKey,
        refunded_at: now.toISOString(),
        updated_at: trx.fn.now(),
      });
    await trx('quota_periods')
      .where({ quota_period_id: period.quota_period_id })
      .update({ reserved_units: refundedCounters.reservedUnits, updated_at: trx.fn.now() });
    await trx('quota_usage_ledger').insert({
      usage_entry_id: randomUUID(),
      user_id: userId,
      entitlement_key: reservation.entitlement_key,
      quota_period_id: reservation.quota_period_id,
      reservation_id: reservationId,
      entry_type: 'REFUND',
      units,
      idempotency_key: input.idempotencyKey,
      correlation_id: correlationId,
      metadata: {},
    });

    reservation = (await trx<QuotaReservationRow>('quota_reservations')
      .where({ reservation_id: reservationId })
      .forUpdate()
      .first()) as QuotaReservationRow;
    period = (await trx<QuotaPeriodRow>('quota_periods')
      .where({ quota_period_id: period.quota_period_id })
      .forUpdate()
      .first()) as QuotaPeriodRow;
    await emitQuotaEvent(trx, 'economy.quota.refunded.v1', reservation, period, correlationId);
    return { kind: 'ok' as const, ...reservationSnapshot(reservation, period) };
  });

  if (outcome.kind === 'expired') {
    throw new ApiError(409, 'QUOTA_RESERVATION_EXPIRED', 'The quota reservation expired.', {
      reservation: outcome.reservation,
      quota: outcome.quota,
    });
  }
  return outcome;
}
