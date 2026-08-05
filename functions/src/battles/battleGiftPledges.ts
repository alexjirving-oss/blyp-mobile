/**
 * Bridge Firestore battle lifecycle → live-service gift pledges.
 *
 * Apply when the match clock starts (liveStartedAt); refund when the battle is
 * cancelled or rejected. Uses the same INTERNAL_SHARED_SECRET path as
 * subscription coin grants.
 */

import { admin } from '../firebaseAdmin';

async function callLiveService(path: string, body: Record<string, unknown>): Promise<any | null> {
  const base = String(process.env.LIVE_SERVICE_BASE_URL || '').replace(/\/+$/, '');
  const secret = String(process.env.INTERNAL_SHARED_SECRET || '').trim();
  if (!base || !secret) {
    console.error(
      '[battleGiftPledges] SKIPPED: LIVE_SERVICE_BASE_URL / INTERNAL_SHARED_SECRET not configured'
    );
    return null;
  }
  try {
    const resp = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('[battleGiftPledges] call failed', path, resp.status, text.slice(0, 300));
      return null;
    }
    return await resp.json().catch(() => ({}));
  } catch (e) {
    console.error('[battleGiftPledges] call error', path, (e as Error)?.message);
    return null;
  }
}

/** Apply held pledges and bump Firestore battle score. Idempotent. */
export async function applyBattleGiftPledgesFromFunction(params: {
  battleId: string;
  streamId?: string | null;
}): Promise<void> {
  const { battleId, streamId } = params;
  const data = await callLiveService('/internal/battle/gift-pledges/apply', {
    battleId,
    streamId: streamId || undefined,
    idempotencyKey: `cf-btlgiftapply:${battleId}`,
  });
  if (!data) return;

  const delta = data.scoreDelta || { creator: 0, opponent: 0 };
  const creatorDelta = Math.max(0, Math.round(Number(delta.creator) || 0));
  const opponentDelta = Math.max(0, Math.round(Number(delta.opponent) || 0));
  if (creatorDelta <= 0 && opponentDelta <= 0) return;

  const db = admin.firestore();
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (creatorDelta > 0) patch['score.creator'] = admin.firestore.FieldValue.increment(creatorDelta);
  if (opponentDelta > 0) patch['score.opponent'] = admin.firestore.FieldValue.increment(opponentDelta);
  try {
    await db.collection('battles').doc(battleId).update(patch);
  } catch (e) {
    console.error('[battleGiftPledges] score update failed', battleId, (e as Error)?.message);
  }
}

/** Refund all held pledges for a cancelled/rejected battle. */
export async function refundBattleGiftPledgesFromFunction(battleId: string): Promise<void> {
  await callLiveService('/internal/battle/gift-pledges/refund', {
    battleId,
    idempotencyKey: `cf-btlgiftrefund:${battleId}`,
  });
}
