// scheduledPublishService.js
//
// Client controls for staggered import posts: list / pause / resume / cancel /
// reschedule / publish-now. Owner-only Firestore writes (rules already allow
// post owners to update their docs).

import { db, firebaseEnabled } from '../config/firebase';
import {
  PUBLISH_STATUS,
  formatPublishAt,
  isNonLivePublishStatus,
  normalizeStagger,
  publishAtForIndex,
} from '../utils/publishSchedule';

function fsReady() {
  return firebaseEnabled && db && typeof db.collection === 'function';
}

/**
 * Subscribe to the user's non-live scheduled/paused import posts (newest publishAt first).
 * @returns {() => void}
 */
export function subscribeScheduledPosts(uid, cb) {
  if (!fsReady() || !uid) {
    try { cb([]); } catch { /* ignore */ }
    return () => {};
  }
  try {
    // Avoid composite index: filter uid client-side status.
    return db
      .collection('posts')
      .where('userId', '==', uid)
      .limit(400)
      .onSnapshot(
        (snap) => {
          const docs = (snap?.docs || [])
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((p) => isNonLivePublishStatus(p) && p.publishStatus !== PUBLISH_STATUS.CANCELED)
            .sort((a, b) => (Number(a.publishAt) || 0) - (Number(b.publishAt) || 0));
          try { cb(docs); } catch { /* ignore */ }
        },
        (err) => {
          console.warn('[schedule] subscribe failed', err?.message || String(err));
          try { cb([]); } catch { /* ignore */ }
        },
      );
  } catch (e) {
    console.warn('[schedule] subscribe threw', e?.message || String(e));
    try { cb([]); } catch { /* ignore */ }
    return () => {};
  }
}

async function patchPost(postId, patch) {
  if (!fsReady() || !postId) return;
  await db.collection('posts').doc(postId).update({
    ...patch,
    updatedAt: Date.now(),
  });
}

export async function pauseScheduledPost(postId) {
  await patchPost(postId, { publishStatus: PUBLISH_STATUS.PAUSED });
}

export async function resumeScheduledPost(postId, publishAt) {
  const at = Number(publishAt) > Date.now() ? Number(publishAt) : Date.now() + 60 * 1000;
  await patchPost(postId, {
    publishStatus: PUBLISH_STATUS.SCHEDULED,
    publishAt: at,
  });
}

export async function cancelScheduledPost(postId) {
  await patchPost(postId, {
    publishStatus: PUBLISH_STATUS.CANCELED,
    canceledAt: Date.now(),
  });
}

export async function reschedulePost(postId, publishAt) {
  const at = Number(publishAt);
  if (!Number.isFinite(at) || at <= 0) throw new Error('Pick a valid publish time.');
  await patchPost(postId, {
    publishStatus: PUBLISH_STATUS.SCHEDULED,
    publishAt: at,
  });
}

/** Flip to live immediately (owner). */
export async function publishScheduledNow(postId) {
  await patchPost(postId, {
    publishStatus: PUBLISH_STATUS.LIVE,
    publishedAt: Date.now(),
    publishAt: Date.now(),
  });
}

/**
 * Pause / resume / cancel every non-live post for an import job (or all for uid).
 */
export async function bulkUpdateScheduled({ uid, importId, action, stagger }) {
  if (!fsReady() || !uid) throw new Error('Not signed in.');
  const snap = await db.collection('posts').where('userId', '==', uid).limit(500).get();
  const targets = (snap?.docs || []).filter((d) => {
    const p = d.data() || {};
    if (importId && p.importId !== importId) return false;
    return p.publishStatus === PUBLISH_STATUS.SCHEDULED || p.publishStatus === PUBLISH_STATUS.PAUSED;
  });

  const now = Date.now();
  let i = 0;
  const norm = action === 'resume' ? normalizeStagger(stagger || { enabled: true, startAt: now }) : null;

  for (const d of targets) {
    if (action === 'pause') {
      // eslint-disable-next-line no-await-in-loop
      await d.ref.update({ publishStatus: PUBLISH_STATUS.PAUSED, updatedAt: now });
    } else if (action === 'cancel') {
      // eslint-disable-next-line no-await-in-loop
      await d.ref.update({
        publishStatus: PUBLISH_STATUS.CANCELED,
        canceledAt: now,
        updatedAt: now,
      });
    } else if (action === 'resume') {
      const at = publishAtForIndex(norm, i, now);
      i += 1;
      // eslint-disable-next-line no-await-in-loop
      await d.ref.update({
        publishStatus: PUBLISH_STATUS.SCHEDULED,
        publishAt: at,
        updatedAt: now,
      });
    } else if (action === 'publish_all_now') {
      // eslint-disable-next-line no-await-in-loop
      await d.ref.update({
        publishStatus: PUBLISH_STATUS.LIVE,
        publishedAt: now,
        publishAt: now,
        updatedAt: now,
      });
    }
  }

  if (importId) {
    try {
      await db.collection('socialImports').doc(importId).update({
        staggerPaused: action === 'pause',
        updatedAt: now,
        message:
          action === 'pause' ? 'Publish schedule paused.'
            : action === 'cancel' ? 'Remaining scheduled posts canceled.'
              : action === 'publish_all_now' ? 'All remaining posts published.'
                : 'Publish schedule resumed.',
      });
    } catch { /* import may be terminal / rules may block — posts still updated */ }
  }

  return { count: targets.length };
}

export { formatPublishAt, PUBLISH_STATUS };

export default {
  subscribeScheduledPosts,
  pauseScheduledPost,
  resumeScheduledPost,
  cancelScheduledPost,
  reschedulePost,
  publishScheduledNow,
  bulkUpdateScheduled,
  formatPublishAt,
  PUBLISH_STATUS,
};
