/**
 * blypReachSweep — the heartbeat of earn-your-reach.
 *
 * Every hour it folds the latest batch of post signals (impressions/likes/shares/
 * saves/watch-through) into each post's transparent Blyp Score and wave, promoting
 * posts that genuinely connect and gently resting those that don't. It uses a
 * timestamp cursor (platformState/reachSweep) so it never reprocesses an event and
 * needs no extra composite index.
 *
 * Authority lives here: the client only *reports* signals and *reads* the resulting
 * score. Merit cannot be faked from the app.
 */

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { COLLECTIONS, PostReach } from '../platform/types';
import { applyReachDeltas, emptyEngagements } from './reach';

const CURSOR_DOC = 'reachSweep';
const COMPLETION_THRESHOLD = 0.9;
const MAX_EVENTS_PER_RUN = 4000;

interface Agg {
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  completions: number;
  dwellMsTotal: number;
  ownerId?: string;
}

function emptyAgg(): Agg {
  return { ...emptyEngagements(), impressions: 0 };
}

export const blypReachSweep = functions
  .runWith({ memory: '512MB', timeoutSeconds: 300 })
  .pubsub.schedule('every 60 minutes')
  .onRun(async () => {
    initFirebaseAdmin();
    const db = admin.firestore();
    const cursorRef = db.collection(COLLECTIONS.platformState).doc(CURSOR_DOC);
    const cursorSnap = await cursorRef.get();
    const lastTs = Number((cursorSnap.data() as any)?.lastTs || 0);

    const evSnap = await db
      .collection(COLLECTIONS.impressionEvents)
      .where('ts', '>', lastTs)
      .orderBy('ts', 'asc')
      .limit(MAX_EVENTS_PER_RUN)
      .get();

    if (evSnap.empty) {
      console.log('[blypReachSweep] no new events');
      return null;
    }

    const perPost = new Map<string, Agg>();
    let maxTs = lastTs;
    for (const d of evSnap.docs) {
      const ev = d.data() as any;
      const ts = Number(ev.ts || 0);
      if (ts > maxTs) maxTs = ts;
      const postId = String(ev.postId || '');
      if (!postId) continue;
      const a = perPost.get(postId) || emptyAgg();
      if (ev.ownerId) a.ownerId = String(ev.ownerId);
      switch (ev.type) {
        case 'impression':
          a.impressions += 1;
          break;
        case 'like':
          a.likes += 1;
          break;
        case 'comment':
          a.comments += 1;
          break;
        case 'share':
          a.shares += 1;
          break;
        case 'save':
          a.saves += 1;
          break;
        case 'watch':
          a.dwellMsTotal += Number(ev.dwellMs || 0);
          if (Number(ev.completion || 0) >= COMPLETION_THRESHOLD) a.completions += 1;
          break;
        default:
          break;
      }
      perPost.set(postId, a);
    }

    let updated = 0;
    for (const [postId, a] of perPost) {
      const postRef = db.collection(COLLECTIONS.posts).doc(postId);
      try {
        // eslint-disable-next-line no-await-in-loop
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(postRef);
          if (!snap.exists) return; // post deleted — drop its signals
          const prev = (snap.data() as any)?.reach as PostReach | undefined;
          const next = applyReachDeltas(
            prev,
            {
              impressions: a.impressions,
              likes: a.likes,
              comments: a.comments,
              shares: a.shares,
              saves: a.saves,
              completions: a.completions,
              dwellMsTotal: a.dwellMsTotal,
            },
            Date.now()
          );
          tx.set(postRef, { reach: next }, { merge: true });
        });
        updated += 1;
      } catch (e) {
        console.warn('[blypReachSweep] post update failed', postId, (e as Error)?.message);
      }
    }

    await cursorRef.set({ lastTs: maxTs, updatedAt: Date.now() }, { merge: true });
    console.log(`[blypReachSweep] processed ${evSnap.size} events across ${perPost.size} posts, updated ${updated}`);
    return null;
  });
