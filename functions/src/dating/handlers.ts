/**
 * blypDatingLike — mutual-match write path for Blyp Dating.
 *
 * POST { toUid }  (Bearer Firebase ID token)
 *   -> 200 { ok, liked, matched, matchId?, alreadyLiked? }
 *
 * Server owns match creation so clients cannot forge datingMatches docs.
 * Passes stay client-writable (own docs only) under firestore rules.
 */

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { applyCors } from '../http/cors';
import { getSubscriptionState } from '../assistant/entitlement';

initFirebaseAdmin();

const COLLECTIONS = {
  prefs: 'datingPrefs',
  likes: 'datingLikes',
  matches: 'datingMatches',
  users: 'users',
} as const;

function likeDocId(fromUid: string, toUid: string): string {
  return fromUid + '_' + toUid;
}

function matchDocId(a: string, b: string): string {
  return a < b ? a + '_' + b : b + '_' + a;
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

    const authHeader = String(req.headers.authorization || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    let fromUid = '';
    try {
      if (!idToken) throw new Error('missing-token');
      const decoded = await admin.auth().verifyIdToken(idToken);
      fromUid = decoded.uid;
    } catch {
      res.status(401).json({ ok: false, reason: 'unauthenticated' });
      return;
    }

    const sub = await getSubscriptionState(fromUid);
    if (!sub.active) {
      res.status(402).json({ ok: false, reason: 'subscription_required' });
      return;
    }

    const body = req.body || {};
    const toUid = typeof body.toUid === 'string' ? body.toUid.trim() : '';
    if (!toUid || toUid === fromUid) {
      res.status(400).json({ ok: false, reason: 'invalid_target' });
      return;
    }

    const db = admin.firestore();

    try {
      const myPrefsSnap = await db.collection(COLLECTIONS.prefs).doc(fromUid).get();
      const myPrefs = myPrefsSnap.data() || {};
      if (!myPrefs.adultConfirmed || !myPrefs.optedIn) {
        res.status(403).json({ ok: false, reason: 'dating_not_enabled' });
        return;
      }

      const theirPrefsSnap = await db.collection(COLLECTIONS.prefs).doc(toUid).get();
      const theirPrefs = theirPrefsSnap.data() || {};
      if (!theirPrefs.adultConfirmed || !theirPrefs.optedIn) {
        res.status(404).json({ ok: false, reason: 'target_unavailable' });
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
