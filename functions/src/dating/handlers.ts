/**
 * Dating write path — Phase 5 safety hardening.
 *
 * blypDatingLike  POST { toUid }  → mutual-match (server-owned datingMatches)
 * blypDatingPass  POST { toUid }  → rate-limited pass write
 *
 * Both require: Bearer Firebase ID token, active Plus/trial entitlement,
 * caller profile verified, opted-in + adultConfirmed + birthYear (self-report age ≥ 18),
 * and target similarly discoverable. Rate limits fail closed.
 */

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { applyCors } from '../http/cors';
import { getSubscriptionState } from '../assistant/entitlement';
import { checkRateLimit, RateLimitOptions } from '../platform/rateLimit';

initFirebaseAdmin();

const COLLECTIONS = {
  prefs: 'datingPrefs',
  likes: 'datingLikes',
  passes: 'datingPasses',
  matches: 'datingMatches',
  users: 'users',
} as const;

const AGE_MIN = 18;
/** Burst: 20 likes / rolling minute (anti-script). */
const LIKE_RATE: RateLimitOptions = { windowMs: 60_000, max: 20, failOpen: false };
/** Burst: 40 passes / rolling minute. */
const PASS_RATE: RateLimitOptions = { windowMs: 60_000, max: 40, failOpen: false };

function likeDocId(fromUid: string, toUid: string): string {
  return fromUid + '_' + toUid;
}

function matchDocId(a: string, b: string): string {
  return a < b ? a + '_' + b : b + '_' + a;
}

function ageFromBirthYear(birthYear: unknown): number | null {
  const y = Number(birthYear);
  if (!Number.isFinite(y)) return null;
  const age = new Date().getFullYear() - Math.round(y);
  if (age < AGE_MIN || age > 120) return null;
  return age;
}

type PrefsGate =
  | { ok: true; prefs: Record<string, any> }
  | { ok: false; reason: string; status: number };

function gatePrefs(snap: admin.firestore.DocumentSnapshot, role: 'caller' | 'target'): PrefsGate {
  if (!snap.exists) {
    return {
      ok: false,
      reason: role === 'caller' ? 'dating_not_enabled' : 'target_unavailable',
      status: role === 'caller' ? 403 : 404,
    };
  }
  const prefs = snap.data() || {};
  if (!prefs.adultConfirmed || !prefs.optedIn) {
    return {
      ok: false,
      reason: role === 'caller' ? 'dating_not_enabled' : 'target_unavailable',
      status: role === 'caller' ? 403 : 404,
    };
  }
  if (ageFromBirthYear(prefs.birthYear) == null) {
    return {
      ok: false,
      reason: role === 'caller' ? 'birth_year_required' : 'target_unavailable',
      status: role === 'caller' ? 403 : 404,
    };
  }
  return { ok: true, prefs };
}

async function requireVerifiedCaller(
  db: admin.firestore.Firestore,
  uid: string
): Promise<{ ok: true } | { ok: false; reason: string; status: number }> {
  try {
    const snap = await db.collection(COLLECTIONS.users).doc(uid).get();
    const data = snap.exists ? snap.data() || {} : {};
    const verified =
      data.verified === true ||
      data.isVerified === true ||
      data.verificationStatus === 'verified';
    if (!verified) {
      return { ok: false, reason: 'verification_required', status: 403 };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'verification_required', status: 403 };
  }
}

async function requireAuth(req: functions.https.Request): Promise<string | null> {
  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  if (!idToken) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid || null;
  } catch {
    return null;
  }
}

function parseToUid(body: any, fromUid: string): string | null {
  const toUid = typeof body?.toUid === 'string' ? body.toUid.trim() : '';
  if (!toUid || toUid === fromUid) return null;
  return toUid;
}

export const blypDatingLike = functions
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

    const fromUid = await requireAuth(req);
    if (!fromUid) {
      res.status(401).json({ ok: false, reason: 'unauthenticated' });
      return;
    }

    const rl = await checkRateLimit('dating_like_' + fromUid, LIKE_RATE);
    if (!rl.allowed) {
      res.set('Retry-After', String(rl.retryAfterSec || 60));
      res.status(429).json({ ok: false, reason: 'rate_limited', retryAfterSec: rl.retryAfterSec });
      return;
    }

    const sub = await getSubscriptionState(fromUid);
    if (!sub.active) {
      res.status(402).json({ ok: false, reason: 'subscription_required' });
      return;
    }

    const toUid = parseToUid(req.body, fromUid);
    if (!toUid) {
      res.status(400).json({ ok: false, reason: 'invalid_target' });
      return;
    }

    const db = admin.firestore();

    const verifiedGate = await requireVerifiedCaller(db, fromUid);
    if (!verifiedGate.ok) {
      res.status(verifiedGate.status).json({ ok: false, reason: verifiedGate.reason });
      return;
    }

    try {
      const [myPrefsSnap, theirPrefsSnap] = await Promise.all([
        db.collection(COLLECTIONS.prefs).doc(fromUid).get(),
        db.collection(COLLECTIONS.prefs).doc(toUid).get(),
      ]);

      const myGate = gatePrefs(myPrefsSnap, 'caller');
      if (!myGate.ok) {
        res.status(myGate.status).json({ ok: false, reason: myGate.reason });
        return;
      }
      const theirGate = gatePrefs(theirPrefsSnap, 'target');
      if (!theirGate.ok) {
        res.status(theirGate.status).json({ ok: false, reason: theirGate.reason });
        return;
      }

      const [iBlockThem, theyBlockMe] = await Promise.all([
        db.collection(COLLECTIONS.users).doc(fromUid).collection('blocks').doc(toUid).get(),
        db.collection(COLLECTIONS.users).doc(toUid).collection('blocks').doc(fromUid).get(),
      ]);
      if (iBlockThem.exists || theyBlockMe.exists) {
        res.status(403).json({ ok: false, reason: 'blocked' });
        return;
      }

      const likeRef = db.collection(COLLECTIONS.likes).doc(likeDocId(fromUid, toUid));
      const reverseRef = db.collection(COLLECTIONS.likes).doc(likeDocId(toUid, fromUid));
      const mId = matchDocId(fromUid, toUid);
      const matchRef = db.collection(COLLECTIONS.matches).doc(mId);

      const result = await db.runTransaction(async (tx) => {
        const likeSnap = await tx.get(likeRef);
        const reverseSnap = await tx.get(reverseRef);
        const matchSnap = await tx.get(matchRef);

        if (likeSnap.exists) {
          return {
            liked: true,
            alreadyLiked: true,
            matched: matchSnap.exists,
            matchId: matchSnap.exists ? mId : null,
          };
        }

        const now = Date.now();
        tx.set(likeRef, {
          fromUid,
          toUid,
          createdAt: now,
        });

        const mutual = reverseSnap.exists;
        if (mutual && !matchSnap.exists) {
          const members = fromUid < toUid ? [fromUid, toUid] : [toUid, fromUid];
          tx.set(matchRef, {
            members,
            memberA: members[0],
            memberB: members[1],
            createdAt: now,
            createdByLike: likeDocId(fromUid, toUid),
          });
        }

        return {
          liked: true,
          alreadyLiked: false,
          matched: mutual || matchSnap.exists,
          matchId: mutual || matchSnap.exists ? mId : null,
        };
      });

      res.status(200).json({ ok: true, ...result });
    } catch (e: any) {
      console.error('[blypDatingLike]', e?.message || String(e));
      res.status(500).json({ ok: false, reason: 'error' });
    }
  });

export const blypDatingPass = functions
  .runWith({ memory: '256MB', timeoutSeconds: 20 })
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

    const fromUid = await requireAuth(req);
    if (!fromUid) {
      res.status(401).json({ ok: false, reason: 'unauthenticated' });
      return;
    }

    const rl = await checkRateLimit('dating_pass_' + fromUid, PASS_RATE);
    if (!rl.allowed) {
      res.set('Retry-After', String(rl.retryAfterSec || 60));
      res.status(429).json({ ok: false, reason: 'rate_limited', retryAfterSec: rl.retryAfterSec });
      return;
    }

    const sub = await getSubscriptionState(fromUid);
    if (!sub.active) {
      res.status(402).json({ ok: false, reason: 'subscription_required' });
      return;
    }

    const toUid = parseToUid(req.body, fromUid);
    if (!toUid) {
      res.status(400).json({ ok: false, reason: 'invalid_target' });
      return;
    }

    const db = admin.firestore();

    const verifiedGate = await requireVerifiedCaller(db, fromUid);
    if (!verifiedGate.ok) {
      res.status(verifiedGate.status).json({ ok: false, reason: verifiedGate.reason });
      return;
    }

    try {
      const myPrefsSnap = await db.collection(COLLECTIONS.prefs).doc(fromUid).get();
      const myGate = gatePrefs(myPrefsSnap, 'caller');
      if (!myGate.ok) {
        res.status(myGate.status).json({ ok: false, reason: myGate.reason });
        return;
      }

      const passRef = db.collection(COLLECTIONS.passes).doc(likeDocId(fromUid, toUid));
      const existing = await passRef.get();
      if (existing.exists) {
        res.status(200).json({ ok: true, passed: true, alreadyPassed: true });
        return;
      }

      await passRef.set({
        fromUid,
        toUid,
        createdAt: Date.now(),
      });

      res.status(200).json({ ok: true, passed: true, alreadyPassed: false });
    } catch (e: any) {
      console.error('[blypDatingPass]', e?.message || String(e));
      res.status(500).json({ ok: false, reason: 'error' });
    }
  });
