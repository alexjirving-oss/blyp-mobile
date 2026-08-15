import { createHash } from 'crypto';
import type { Grid9ClientIntentType } from './protocol';

type JsonPrimitive = null | boolean | number | string;
export type Grid9CanonicalJson =
  | JsonPrimitive
  | Grid9CanonicalJson[]
  | { [key: string]: Grid9CanonicalJson };

export function canonicalizeGrid9Json(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonical JSON does not allow non-finite numbers');
    }
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeGrid9Json).join(',')}]`;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('canonical JSON accepts only plain objects');
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => {
        if (entry === undefined) {
          throw new TypeError('canonical JSON does not allow undefined values');
        }
        return `${JSON.stringify(key)}:${canonicalizeGrid9Json(entry)}`;
      });
    return `{${entries.join(',')}}`;
  }
  throw new TypeError(`canonical JSON does not allow ${typeof value}`);
}

export function grid9CanonicalIntentHash(args: {
  authenticatedUserId: string;
  matchId: string | null;
  type: Grid9ClientIntentType;
  payload: unknown;
}): string {
  const canonicalIntent = canonicalizeGrid9Json({
    authenticatedUserId: args.authenticatedUserId,
    matchId: args.matchId,
    type: args.type,
    payload: args.payload,
  });
  return createHash('sha256').update(canonicalIntent, 'utf8').digest('hex');
}

export function grid9CanonicalOperationHash(args: {
  matchId: string;
  operationId: string;
  kind: string;
  payload: unknown;
}): string {
  const canonicalOperation = canonicalizeGrid9Json({
    matchId: args.matchId,
    operationId: args.operationId,
    kind: args.kind,
    payload: args.payload,
  });
  return createHash('sha256')
    .update(canonicalOperation, 'utf8')
    .digest('hex');
}
