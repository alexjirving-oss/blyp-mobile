// streakService — client for the server-authoritative daily streak engine.
//
// Authority lives in the live service (the SAME economy backend that owns the
// wallet the app displays), so a claimed reward is immediately reflected in the
// user's coin balance. Coins are credited through the audited `ledger_entries`
// path with a globally-unique idempotency key (`daily:<sub>:<UTC-day>`) — so a
// claim can never double-pay, even on retries or concurrent taps.
//
//   GET  /economy/daily-reward        -> { ok, streak, claimedToday, claimableReward }
//   POST /economy/daily-reward/claim  -> { ok, alreadyClaimed, streak, reward, balanceCoins }
//
// Auth is the Cognito JWT (same as every other economy call); there is no longer
// any dependency on Firebase tokens for the daily reward.

import { callEconomyBackend } from '../api/economyLiveApi';

const PEEK_PATH = '/economy/daily-reward';
const CLAIM_PATH = '/economy/daily-reward/claim';

// Map a thrown economy/auth error to the client's `{ ok:false, reason }` shape.
function toFailure(e, fallback) {
  const status = e?.httpStatus;
  const msg = String(e?.message || fallback);
  // getCognitoJwtForApi throws (before any fetch) when there is no valid session.
  const looksLoggedOut =
    status === 401 ||
    /cognito|logged in|not authenticated|session/i.test(msg);
  if (looksLoggedOut) return { ok: false, reason: 'unauthenticated' };
  return { ok: false, reason: msg || fallback };
}

/** Peek the current streak + claimable reward without mutating anything. */
export async function peekDailyReward() {
  try {
    const data = await callEconomyBackend(PEEK_PATH, 'GET');
    if (data?.ok) return data;
    return { ok: false, reason: data?.reason || 'peek-failed' };
  } catch (e) {
    return toFailure(e, 'peek-failed');
  }
}

/** Claim today's reward. Idempotent server-side; safe to call once per tap. */
export async function claimDailyReward() {
  try {
    const data = await callEconomyBackend(CLAIM_PATH, 'POST', {});
    if (data?.ok) return data;
    return { ok: false, reason: data?.reason || 'claim-failed' };
  } catch (e) {
    return toFailure(e, 'claim-failed');
  }
}

export default { peekDailyReward, claimDailyReward };
