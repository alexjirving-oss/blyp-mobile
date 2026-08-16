// treasureChestService — verified-account daily treasure chest (live-service).
//
//   GET  /economy/treasure-chest       -> peek
//   POST /economy/treasure-chest/claim  -> base grant
//   POST /economy/treasure-chest/bonus  -> video-post bonus
//
// Auth: Cognito JWT via callEconomyBackend. Coins credit the same wallet as IAP/grants.

import { callEconomyBackend } from '../api/economyLiveApi';

const PEEK_PATH = '/economy/treasure-chest';
const CLAIM_PATH = '/economy/treasure-chest/claim';
const BONUS_PATH = '/economy/treasure-chest/bonus';

function toFailure(e, fallback) {
  const status = e?.httpStatus;
  const msg = String(e?.message || fallback);
  const looksLoggedOut =
    status === 401 ||
    /cognito|logged in|not authenticated|session/i.test(msg);
  if (looksLoggedOut) return { ok: false, reason: 'unauthenticated' };
  if (status === 403) {
    return {
      ok: false,
      reason: e?.detail?.reason || e?.reason || 'not_verified',
      code: e?.code || 'RESTRICTED',
    };
  }
  return {
    ok: false,
    reason: e?.detail?.reason || e?.reason || msg || fallback,
    code: e?.code,
    detail: e?.detail,
  };
}

export async function peekTreasureChest() {
  try {
    const data = await callEconomyBackend(PEEK_PATH, 'GET');
    if (data?.ok) return data;
    return { ok: false, reason: data?.reason || 'peek-failed' };
  } catch (e) {
    return toFailure(e, 'peek-failed');
  }
}

export async function claimTreasureChest() {
  try {
    const data = await callEconomyBackend(CLAIM_PATH, 'POST', {});
    if (data?.ok) return data;
    return { ok: false, reason: data?.reason || 'claim-failed', code: data?.code, detail: data?.detail };
  } catch (e) {
    return toFailure(e, 'claim-failed');
  }
}

export async function claimTreasureChestBonus(postId) {
  try {
    const body = postId ? { postId: String(postId) } : {};
    const data = await callEconomyBackend(BONUS_PATH, 'POST', body);
    if (data?.ok) return data;
    return { ok: false, reason: data?.reason || 'bonus-failed', code: data?.code, detail: data?.detail };
  } catch (e) {
    return toFailure(e, 'bonus-failed');
  }
}

export default { peekTreasureChest, claimTreasureChest, claimTreasureChestBonus };
