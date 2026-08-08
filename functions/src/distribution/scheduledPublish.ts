/**
 * blypScheduledPublishSweep — flips due scheduled posts to live.
 *
 * Import worker (and future compose scheduling) writes posts with
 * publishStatus=scheduled + publishAt. This job publishes them when due so
 * feeds never dump a whole TikTok library at once.
 */

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';

const MAX_PER_RUN = 80;

export const blypScheduledPublishSweep = functions
  .runWith({ memory: '256MB', timeoutSeconds: 180 })
  .pubsub.schedule('every 5 minutes')
  .onRun(async () => {
    initFirebaseAdmin();
    const db = admin.firestore();
    const now = Date.now();

    let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    try {
      const snap = await db
        .collection('posts')
        .where('publishStatus', '==', 'scheduled')
        .where('publishAt', '<=', now)
        .orderBy('publishAt', 'asc')
        .limit(MAX_PER_RUN)
        .get();
      docs = snap.docs;
    } catch (e) {
      // Index may still be building — fall back to status-only + filter.
      console.warn('[blypScheduledPublishSweep] indexed query failed, falling back', (e as Error)?.message);
      const loose = await db
        .collection('posts')
        .where('publishStatus', '==', 'scheduled')
        .limit(200)
        .get();
      docs = loose.docs
        .filter((d) => Number((d.data() as any)?.publishAt || 0) <= now)
        .sort(
          (a, b) =>
            Number((a.data() as any).publishAt || 0) - Number((b.data() as any).publishAt || 0),
        )
        .slice(0, MAX_PER_RUN);
    }

    if (!docs.length) {
      console.log('[blypScheduledPublishSweep] nothing due');
      return null;
    }

    let published = 0;
    for (const doc of docs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          if (!fresh.exists) return;
          const data = fresh.data() as any;
          if (data.publishStatus !== 'scheduled') return;
          if (Number(data.publishAt || 0) > now) return;
          tx.update(doc.ref, {
            publishStatus: 'live',
            publishedAt: now,
            updatedAt: now,
          });
        });
        published += 1;
      } catch (e) {
        console.warn('[blypScheduledPublishSweep] failed', doc.id, (e as Error)?.message);
      }
    }

    console.log(`[blypScheduledPublishSweep] published ${published}/${docs.length}`);
    return null;
  });
