/**
 * Badge awards (Clubs Phase 3) — server-minted earnable badges.
 *
 * POST /blypSyncBadgeAwards  (Bearer Firebase ID token)
 *   -> 200 { ok, awarded: string[], earned: string[] }
 *
 * Clients may equip earned + pickable catalog badges only.
 * Award docs live at badgeAwards/{uid}/items/{badgeId}; clients cannot write.
 */

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { applyCors } from '../http/cors';

initFirebaseAdmin();

const AWARDS_COL = 'badgeAwards';
const ITEMS = 'items';

/** Catalog ids the server may mint. Keep in sync with client BADGE_CATALOG earn:'server'. */
export const SERVER_BADGE_IDS = {
  liveHost: 'badge_live_host',
  marblePodium: 'badge_marble_podium',
  earlyBlyper: 'badge_early_blyper',
} as const;

/** Accounts created before this instant qualify for Early Blyper. */
const EARLY_ADOPTER_UNTIL_MS = Date.parse('2026-09-01T00:00:00.000Z');

type AwardSource = 'live_host' | 'marble_podium' | 'early_adopter' | 'admin';

async function listEarnedIds(uid: string): Promise<string[]> {
  const db = admin.firestore();
  const snap = await db.collection(AWARDS_COL).doc(uid).collection(ITEMS).get();
  return snap.docs.map((d) => d.id).filter(Boolean).sort();
}

async function mintIfMissing(
  uid: string,
  badgeId: string,
  source: AwardSource,
  meta: Record<string, unknown> = {}
): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.collection(AWARDS_COL).doc(uid).collection(ITEMS).doc(badgeId);
  const existing = await ref.get();
  if (existing.exists) return false;
  await ref.set(
    {
      badgeId,
      uid,
      source,
      earnedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...meta,
    },
    { merge: true }
  );
  return true;
}

async function hasHostedLive(uid: string): Promise<boolean> {
  const db = admin.firestore();
  try {
    const sessions = await db
      .collection('liveSessions')
      .where('hostUserId', '==', uid)
      .limit(1)
      .get();
    if (!sessions.empty) return true;
  } catch (e: any) {
    console.warn('[badges] liveSessions query failed', e?.message || String(e));
  }
  try {
    const streams = await db
      .collection('liveStreams')
      .where('hostUserId', '==', uid)
      .limit(1)
      .get();
    if (!streams.empty) return true;
  } catch (e: any) {
    console.warn('[badges] liveStreams query failed', e?.message || String(e));
  }
  try {
    const streamsByHost = await db
      .collection('liveStreams')
      .where('hostId', '==', uid)
      .limit(1)
      .get();
    if (!streamsByHost.empty) return true;
  } catch {
    /* optional secondary field */
  }
  return false;
}

async function hasMarblePodium(uid: string): Promise<{ ok: boolean; evidence?: string }> {
  const db = admin.firestore();
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    const u = userSnap.data() || {};
    const wins = Number(u.marblePodiumWins || u.marblePodiumCount || 0);
    if (wins >= 1) return { ok: true, evidence: 'users.marblePodiumWins' };
  } catch (e: any) {
    console.warn('[badges] user podium read failed', e?.message || String(e));
  }
  try {
    const evidence = await db.collection('marblePodiumResults').doc(uid).get();
    if (evidence.exists) return { ok: true, evidence: 'marblePodiumResults' };
  } catch (e: any) {
    console.warn('[badges] marblePodiumResults read failed', e?.message || String(e));
  }
  return { ok: false };
}

async function isEarlyAdopter(uid: string): Promise<{ ok: boolean; evidence?: string }> {
  try {
    const user = await admin.auth().getUser(uid);
    const createdMs = user.metadata?.creationTime
      ? Date.parse(user.metadata.creationTime)
      : NaN;
    if (Number.isFinite(createdMs) && createdMs < EARLY_ADOPTER_UNTIL_MS) {
      return { ok: true, evidence: 'auth.creationTime' };
    }
  } catch (e: any) {
    console.warn('[badges] auth early check failed', e?.message || String(e));
  }
  try {
    const db = admin.firestore();
    const userSnap = await db.collection('users').doc(uid).get();
    const u = userSnap.data() || {};
    if (u.earlyAdopter === true || u.earlyBlyper === true) {
      return { ok: true, evidence: 'users.earlyAdopter' };
    }
    const createdAt = u.createdAt;
    let ms = NaN;
    if (createdAt && typeof createdAt.toMillis === 'function') ms = createdAt.toMillis();
    else if (typeof createdAt === 'number') ms = createdAt;
    else if (createdAt instanceof Date) ms = createdAt.getTime();
    else if (typeof createdAt === 'string') ms = Date.parse(createdAt);
    if (Number.isFinite(ms) && ms < EARLY_ADOPTER_UNTIL_MS) {
      return { ok: true, evidence: 'users.createdAt' };
    }
  } catch (e: any) {
    console.warn('[badges] user early check failed', e?.message || String(e));
  }
  return { ok: false };
}

async function denormEarnedBadgeIds(uid: string, earned: string[]): Promise<void> {
  const db = admin.firestore();
  await db
    .collection('users')
    .doc(uid)
    .set(
      {
        earnedBadgeIds: earned,
        earnedBadgeIdsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

/**
 * Evaluate eligibility and mint missing awards for uid.
 * Exported for triggers (live host) and HTTPS sync.
 */
export async function syncBadgeAwardsForUid(uid: string): Promise<{
  awarded: string[];
  earned: string[];
}> {
  const awarded: string[] = [];

  if (await hasHostedLive(uid)) {
    if (await mintIfMissing(uid, SERVER_BADGE_IDS.liveHost, 'live_host')) {
      awarded.push(SERVER_BADGE_IDS.liveHost);
    }
  }

  const marble = await hasMarblePodium(uid);
  if (marble.ok) {
    if (
      await mintIfMissing(uid, SERVER_BADGE_IDS.marblePodium, 'marble_podium', {
        evidence: marble.evidence || null,
      })
    ) {
      awarded.push(SERVER_BADGE_IDS.marblePodium);
    }
  }

  const early = await isEarlyAdopter(uid);
  if (early.ok) {
    if (
      await mintIfMissing(uid, SERVER_BADGE_IDS.earlyBlyper, 'early_adopter', {
        evidence: early.evidence || null,
      })
    ) {
      awarded.push(SERVER_BADGE_IDS.earlyBlyper);
    }
  }

  const earned = await listEarnedIds(uid);
  try {
    await denormEarnedBadgeIds(uid, earned);
  } catch (e: any) {
    console.warn('[badges] denorm earnedBadgeIds failed', e?.message || String(e));
  }
  return { awarded, earned };
}

export const blypSyncBadgeAwards = functions
  .runWith({ memory: '256MB', timeoutSeconds: 30 })
  .https.onRequest(async (req, res) => {
    applyCors(req, res, { methods: 'POST, OPTIONS' });
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, reason: 'method' });
      return;
    }

    const authHeader = String(req.headers.authorization || '');
    const idToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : null;
    let uid = '';
    try {
      if (!idToken) throw new Error('missing-token');
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
    } catch {
      res.status(401).json({ ok: false, reason: 'unauthenticated' });
      return;
    }

    try {
      const result = await syncBadgeAwardsForUid(uid);
      res.status(200).json({ ok: true, ...result });
    } catch (e: any) {
      console.error('[blypSyncBadgeAwards]', e?.message || String(e));
      res.status(500).json({ ok: false, reason: 'internal' });
    }
  });

/**
 * When a live session is created/goes live with a host, mint Live Host badge.
 */
export const onLiveSessionBadgeAward = functions.firestore
  .document('liveSessions/{sessionId}')
  .onWrite(async (change) => {
    const after = change.after.exists ? change.after.data() : null;
    if (!after) return;
    const hostUserId = typeof after.hostUserId === 'string' ? after.hostUserId.trim() : '';
    if (!hostUserId) return;
    const status = String(after.status || '').toLowerCase();
    if (status && status !== 'live' && status !== 'ended' && status !== 'creating') return;
    try {
      await mintIfMissing(hostUserId, SERVER_BADGE_IDS.liveHost, 'live_host', {
        sessionId: change.after.id,
      });
      const earned = await listEarnedIds(hostUserId);
      await denormEarnedBadgeIds(hostUserId, earned);
    } catch (e: any) {
      console.warn('[onLiveSessionBadgeAward]', e?.message || String(e));
    }
  });
