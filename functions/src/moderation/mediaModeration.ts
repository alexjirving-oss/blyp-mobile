/**
 * Server-side image moderation (P0.1).
 *
 * On post creation we run Google Cloud Vision SafeSearch over the post's image
 * (or video thumbnail). If adult / violence / racy content is LIKELY or
 * VERY_LIKELY, we route the post through the same takedown pipeline used by the
 * report auto-action: set posts/{id}.moderation.hidden and raise an admin alert.
 *
 * Safety / rollout:
 *  - Gated behind ENABLE_MEDIA_MODERATION so it can be deployed dark and switched
 *    on once the Vision API + billing are confirmed.
 *  - The Vision client is lazily required, so a missing dependency or unconfigured
 *    API degrades to a no-op instead of crashing the function cold-start.
 *  - Never throws; any failure leaves the post visible (fail-open) and is logged.
 *  - Video is approximated by scanning its thumbnail (full-frame video moderation
 *    is a separate, heavier pipeline).
 */

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';

const ENABLED = String(process.env.ENABLE_MEDIA_MODERATION || '').toLowerCase() === 'true';

// Vision likelihood ordering. We act on LIKELY/VERY_LIKELY for adult & violence,
// and only VERY_LIKELY for racy (racy is broad and prone to false positives).
const HARD = new Set(['LIKELY', 'VERY_LIKELY']);

type Db = admin.firestore.Firestore;

let visionClient: any = null;
let visionInitTried = false;

function getVisionClient(): any {
  if (visionInitTried) return visionClient;
  visionInitTried = true;
  try {
    // Lazy require keeps the dep optional at module-load time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vision = require('@google-cloud/vision');
    visionClient = new vision.ImageAnnotatorClient();
  } catch (e) {
    console.warn('[mediaModeration] Vision client unavailable', (e as any)?.message || String(e));
    visionClient = null;
  }
  return visionClient;
}

function pickImageUri(data: any): string | null {
  const candidates = [
    data?.thumbnail,
    data?.imageUrl,
    Array.isArray(data?.media) && data.media.length ? data.media[0]?.thumbnail || data.media[0]?.url : null,
  ];
  for (const c of candidates) {
    const s = String(c || '').trim();
    if (s && /^https?:\/\//i.test(s)) return s;
  }
  return null;
}

async function hidePost(db: Db, postId: string, reason: string): Promise<void> {
  try {
    await db.collection('posts').doc(postId).set(
      {
        moderation: {
          hidden: true,
          reason,
          source: 'auto_vision',
          at: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
  } catch (e) {
    console.warn('[mediaModeration] hidePost failed', (e as any)?.message || String(e));
  }
}

export const moderatePostMedia = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .firestore.document('posts/{postId}')
  .onCreate(async (snap, context) => {
    if (!ENABLED) return null;
    const data = (snap.data() as any) || {};
    const imageUri = pickImageUri(data);
    if (!imageUri) return null;

    const client = getVisionClient();
    if (!client) return null;

    const postId = String(context.params.postId || '');
    initFirebaseAdmin();
    const db = admin.firestore();

    let safe: any = null;
    try {
      const [result] = await client.safeSearchDetection({ image: { source: { imageUri } } });
      safe = result?.safeSearchAnnotation || null;
    } catch (e) {
      console.warn('[mediaModeration] safeSearch failed (fail-open)', (e as any)?.message || String(e));
      return null;
    }
    if (!safe) return null;

    const adult = String(safe.adult || 'UNKNOWN');
    const violence = String(safe.violence || 'UNKNOWN');
    const racy = String(safe.racy || 'UNKNOWN');
    const medical = String(safe.medical || 'UNKNOWN');

    const flagged =
      HARD.has(adult) ||
      HARD.has(violence) ||
      racy === 'VERY_LIKELY' ||
      medical === 'VERY_LIKELY';

    if (!flagged) return null;

    const reason = `vision:adult=${adult},violence=${violence},racy=${racy},medical=${medical}`;
    await hidePost(db, postId, reason);

    try {
      await db.collection('moderationActions').add({
        actorId: 'system',
        source: 'auto_vision',
        actionType: 'post_hidden',
        targetType: 'post',
        targetId: postId,
        authorId: String(data?.userId || '').trim() || null,
        decisionReason: reason,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await db.collection('adminAlerts').add({
        kind: 'media_moderation',
        severity: HARD.has(adult) || HARD.has(violence) ? 'high' : 'normal',
        targetType: 'post',
        targetId: postId,
        authorId: String(data?.userId || '').trim() || null,
        decisionReason: reason,
        hidden: true,
        status: 'open',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.error(`[ALERT][media_moderation] post/${postId} ${reason}`);
    } catch (e) {
      console.warn('[mediaModeration] audit/alert failed', (e as any)?.message || String(e));
    }
    return null;
  });
