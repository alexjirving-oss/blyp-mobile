import { isEconomyEntitlementsEnabled } from '../config/FeatureFlags';
import { createIdempotencyKey, platformApi } from './platformApiClient';

function disabledError() {
  const error = new Error('The entitlement contract is not enabled.');
  error.code = 'FEATURE_DISABLED';
  return error;
}

function requireEnabled() {
  if (!isEconomyEntitlementsEnabled()) throw disabledError();
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeQuota(quota = {}) {
  return {
    quotaPeriodId: String(quota.quotaPeriodId || ''),
    planId: String(quota.planId || ''),
    periodStart: quota.periodStart || null,
    periodEnd: quota.periodEnd || null,
    allowanceUnits: nonNegativeInteger(quota.allowanceUnits),
    reservedUnits: nonNegativeInteger(quota.reservedUnits),
    committedUnits: nonNegativeInteger(quota.committedUnits),
    availableUnits: nonNegativeInteger(quota.availableUnits),
  };
}

function normalizeReservation(reservation = {}) {
  return {
    reservationId: String(reservation.reservationId || ''),
    entitlementKey: String(reservation.entitlementKey || ''),
    planId: String(reservation.planId || ''),
    units: nonNegativeInteger(reservation.units),
    status: String(reservation.status || ''),
    expiresAt: reservation.expiresAt || null,
    reservedAt: reservation.reservedAt || null,
    committedAt: reservation.committedAt || null,
    refundedAt: reservation.refundedAt || null,
    expiredAt: reservation.expiredAt || null,
  };
}

function normalizeMutation(result = {}) {
  return {
    reservation: normalizeReservation(result.data?.reservation),
    quota: normalizeQuota(result.data?.quota),
    replayed: result.data?.replayed === true,
  };
}

function mutation(operation, idempotencyKey) {
  const key = idempotencyKey || createIdempotencyKey(operation);
  return { key, options: { idempotencyKey: key } };
}

export async function getEconomyEntitlements() {
  requireEnabled();
  const result = await platformApi.get('/api/v1/economy/entitlements');
  const data = result.data || {};
  return {
    plan: {
      planId: String(data.plan?.planId || 'FREE'),
      planTier: data.plan?.planTier === 'PREMIUM' ? 'PREMIUM' : 'FREE',
      planName: String(data.plan?.planName || 'Free'),
      source: String(data.plan?.source || 'FREE_DEFAULT'),
    },
    subscription: data.subscription || null,
    entitlements: Array.isArray(data.entitlements)
      ? data.entitlements.map((item) => ({
          entitlementKey: String(item?.entitlementKey || ''),
          granted: item?.granted === true,
          unitName: String(item?.unitName || ''),
          periodKind: String(item?.periodKind || ''),
          reservationTtlSeconds: nonNegativeInteger(item?.reservationTtlSeconds),
          configuration:
            item?.configuration && typeof item.configuration === 'object'
              ? item.configuration
              : {},
          quota: normalizeQuota(item?.quota),
        }))
      : [],
    evaluatedAt: data.evaluatedAt || null,
  };
}

export async function reserveEconomyQuota({
  entitlementKey,
  units = 1,
  idempotencyKey,
}) {
  requireEnabled();
  const request = mutation('economy-quota-reserve', idempotencyKey);
  const result = await platformApi.post(
    '/api/v1/economy/quota/reservations',
    {
      entitlementKey,
      units,
      idempotencyKey: request.key,
    },
    request.options
  );
  return normalizeMutation(result);
}

export async function commitEconomyQuota({ reservationId, idempotencyKey }) {
  requireEnabled();
  const request = mutation('economy-quota-commit', idempotencyKey);
  const result = await platformApi.post(
    `/api/v1/economy/quota/reservations/${encodeURIComponent(reservationId)}/commit`,
    { idempotencyKey: request.key },
    request.options
  );
  return normalizeMutation(result);
}

export async function refundEconomyQuota({ reservationId, idempotencyKey }) {
  requireEnabled();
  const request = mutation('economy-quota-refund', idempotencyKey);
  const result = await platformApi.post(
    `/api/v1/economy/quota/reservations/${encodeURIComponent(reservationId)}/refund`,
    { idempotencyKey: request.key },
    request.options
  );
  return normalizeMutation(result);
}

export async function withEconomyQuota(
  { entitlementKey, units = 1, reserveIdempotencyKey },
  operation
) {
  if (typeof operation !== 'function') throw new TypeError('operation must be a function');
  const reserved = await reserveEconomyQuota({
    entitlementKey,
    units,
    idempotencyKey: reserveIdempotencyKey,
  });

  try {
    const value = await operation(reserved.reservation);
    await commitEconomyQuota({ reservationId: reserved.reservation.reservationId });
    return value;
  } catch (error) {
    try {
      await refundEconomyQuota({ reservationId: reserved.reservation.reservationId });
    } catch (refundError) {
      error.quotaRefundError = refundError;
    }
    throw error;
  }
}

export { normalizeQuota, normalizeReservation };
