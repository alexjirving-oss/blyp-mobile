/**
 * Abuse rate-limiting for anonymous public endpoints (search).
 *
 * The Charter says anyone can search, and free users get UNLIMITED plain search.
 * So this is NOT a product cap - it is purely an abuse / cost guard against a
 * single client (or script) hammering the endpoint. Thresholds are deliberately
 * generous: a real human searching as fast as they can will never hit them.
 *
 * Implementation: a Firestore fixed-window counter, one tiny doc per caller key
 * (hashed IP + session). Failure-tolerant - if the limiter itself errors, we ALLOW
 * the request (never break search because the guard hiccuped).
 */

import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { COLLECTIONS } from './types';
import { sha256 } from './util';

export interface RateLimitOptions {
  /** Length of the fixed window, in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed within the window before denial. */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the caller should wait before retrying (only when denied). */
  retryAfterSec: number;
  remaining: number;
}

/** Generous default: 40 requests / 10s burst per caller key. */
export const SEARCH_RATE_LIMIT: RateLimitOptions = { windowMs: 10_000, max: 40 };

/**
 * Derive a stable, privacy-preserving caller key from the request. Uses the
 * forwarded client IP (Cloud Functions sits behind a proxy) plus the app session.
 * The raw values are hashed so we never persist an IP in plaintext.
 */
export function callerKey(ip: string | undefined, session: string | undefined): string {
  const raw = `${ip || 'noip'}|${session || 'anon'}`;
  return sha256(raw).slice(0, 32);
}

/**
 * Atomically increment the fixed-window counter for `key` and decide whether the
 * request is allowed. One Firestore doc per key; the window resets in place, so the
 * collection size is bounded by the number of distinct callers (swept on retention).
 */
export async function checkRateLimit(
  key: string,
  opts: RateLimitOptions = SEARCH_RATE_LIMIT,
): Promise<RateLimitResult> {
  try {
    initFirebaseAdmin();
    const ref = admin.firestore().collection(COLLECTIONS.rateLimits).doc(key);
    const now = Date.now();

    const result = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() as { windowStart?: number; count?: number }) : null;
      let windowStart = data?.windowStart ?? 0;
      let count = data?.count ?? 0;

      if (!windowStart || now - windowStart >= opts.windowMs) {
        // Start a fresh window.
        windowStart = now;
        count = 1;
      } else {
        count += 1;
      }

      tx.set(
        ref,
        { windowStart, count, updatedAt: now, expiresAt: windowStart + opts.windowMs * 6 },
        { merge: true },
      );

      const allowed = count <= opts.max;
      const retryAfterSec = allowed ? 0 : Math.ceil((windowStart + opts.windowMs - now) / 1000);
      return { allowed, retryAfterSec, remaining: Math.max(0, opts.max - count) };
    });

    return result;
  } catch (e) {
    // Fail OPEN: a limiter failure must never block legitimate search.
    console.error('[rateLimit] error (allowing request)', (e as Error)?.message);
    return { allowed: true, retryAfterSec: 0, remaining: opts.max };
  }
}
