import { ApiError } from '../platform/apiContract';

export type QuotaCounters = {
  allowanceUnits: number;
  reservedUnits: number;
  committedUnits: number;
};

function nonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(500, 'QUOTA_STATE_INVALID', `${field} is invalid.`);
  }
  return value;
}

export function validateQuotaCounters(counters: QuotaCounters): QuotaCounters {
  const allowanceUnits = nonNegativeSafeInteger(counters.allowanceUnits, 'allowanceUnits');
  const reservedUnits = nonNegativeSafeInteger(counters.reservedUnits, 'reservedUnits');
  const committedUnits = nonNegativeSafeInteger(counters.committedUnits, 'committedUnits');
  if (reservedUnits + committedUnits > allowanceUnits) {
    throw new ApiError(500, 'QUOTA_STATE_INVALID', 'Quota counters exceed the allowance.');
  }
  return { allowanceUnits, reservedUnits, committedUnits };
}

export function availableQuotaUnits(counters: QuotaCounters): number {
  const valid = validateQuotaCounters(counters);
  return valid.allowanceUnits - valid.reservedUnits - valid.committedUnits;
}

export function reserveQuotaUnits(counters: QuotaCounters, units: number): QuotaCounters {
  const valid = validateQuotaCounters(counters);
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new ApiError(400, 'QUOTA_UNITS_INVALID', 'Quota units must be a positive integer.');
  }
  if (availableQuotaUnits(valid) < units) {
    throw new ApiError(409, 'QUOTA_EXHAUSTED', 'The requested quota is not available.');
  }
  return { ...valid, reservedUnits: valid.reservedUnits + units };
}

export function commitQuotaUnits(counters: QuotaCounters, units: number): QuotaCounters {
  const valid = validateQuotaCounters(counters);
  if (!Number.isSafeInteger(units) || units <= 0 || valid.reservedUnits < units) {
    throw new ApiError(500, 'QUOTA_STATE_INVALID', 'Committed quota exceeds reserved usage.');
  }
  return {
    ...valid,
    reservedUnits: valid.reservedUnits - units,
    committedUnits: valid.committedUnits + units,
  };
}

export function releaseQuotaUnits(counters: QuotaCounters, units: number): QuotaCounters {
  const valid = validateQuotaCounters(counters);
  if (!Number.isSafeInteger(units) || units <= 0 || valid.reservedUnits < units) {
    throw new ApiError(500, 'QUOTA_STATE_INVALID', 'Released quota exceeds reserved usage.');
  }
  return { ...valid, reservedUnits: valid.reservedUnits - units };
}

export function effectiveAllowanceUnits(
  currentAllowanceUnits: number,
  configuredAllowanceUnits: number,
  reservedUnits: number,
  committedUnits: number
): number {
  return Math.max(
    nonNegativeSafeInteger(currentAllowanceUnits, 'currentAllowanceUnits'),
    nonNegativeSafeInteger(configuredAllowanceUnits, 'configuredAllowanceUnits'),
    nonNegativeSafeInteger(reservedUnits, 'reservedUnits') +
      nonNegativeSafeInteger(committedUnits, 'committedUnits')
  );
}

export function reservationHasExpired(expiresAt: Date | string, now: Date = new Date()): boolean {
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (!Number.isFinite(expiry.getTime()) || !Number.isFinite(now.getTime())) {
    throw new ApiError(500, 'CLOCK_INVALID', 'The quota reservation clock is invalid.');
  }
  return expiry.getTime() <= now.getTime();
}
