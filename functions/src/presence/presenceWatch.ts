/**
 * Presence watches — "notify me when <person> is next on the app".
 *
 * The client stamps users/{uid}.presence = { state: 'online'|'offline', lastSeenAt }
 * on foreground/background. We fire on the offline->online transition and notify
 * anyone who opted in via a `userWatches` doc (key = `<uid>__online`). Watches are
 * one-shot: notify, then deactivate.
 *
 * A scheduled sweep marks stale sessions offline (covers hard kills where the app
 * never wrote 'offline'), so a later open registers as a real transition.
 *
 * Delivery rides the same outbox + dispatcher + FCM spine as everything else.
 */

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { enqueueNotification } from '../notifications/outbox';
import { resolveUserLabel } from '../notifications/resolveUserLabel';

const ENQUEUE_CHUNK = 50;
const STALE_MS = 5 * 60 * 1000; // a session quiet for 5+ minutes counts as offline
const SWEEP_LIMIT = 400;

async function resolveUserName(uid: string): Promise<string> {
  return resolveUserLabel(uid, 'Someone');
}

async function notifyOnlineWatchers(targetUid: string, transitionId: string | number): Promise<void> {
  const db = admin.firestore();
  let snap;
  try {
    snap = await db.collection('userWatches').where('key', '==', `${targetUid}__online`).get();
  } catch (e) {
    console.warn('[presenceWatch] watch query failed', (e as any)?.message || String(e));
    return;
  }

  const watches = snap.docs.filter((d) => (d.data() as any)?.active !== false);
  if (watches.length === 0) return;

  const name = await resolveUserName(targetUid);
  const title = `${name} is on Blyp`;
  const body = 'Tap to open their profile';

  let enqueued = 0;
  for (let i = 0; i < watches.length; i += ENQUEUE_CHUNK) {
    const chunk = watches.slice(i, i + ENQUEUE_CHUNK);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      chunk.map((doc) => {
        const w = doc.data() as any;
        const watcherUid = String(w?.watcherUid || '').trim();
        if (!watcherUid) return Promise.resolve(false);
        return enqueueNotification({
          userId: watcherUid,
          type: 'activity',
          title,
          body,
          // Deterministic per online transition so retries dedupe but a later
          // re-watch + new transition can fire again.
          dedupeKey: `presence:${targetUid}:${watcherUid}:${transitionId}`,
          collapseKey: `presence:${targetUid}`,
          data: {
            type: 'presence',
            targetId: targetUid,
            targetName: name,
            actorUsername: name,
          },
        }).catch(() => false);
      })
    );
    enqueued += results.filter(Boolean).length;

    // eslint-disable-next-line no-await-in-loop
    const batch = db.batch();
    chunk.forEach((doc) => batch.update(doc.ref, { active: false, firedAt: admin.firestore.FieldValue.serverTimestamp() }));
    // eslint-disable-next-line no-await-in-loop
    await batch.commit().catch(() => {});
  }

  console.log(`[presenceWatch] ${targetUid} online: notified ${enqueued} watchers`);
}

/** Fire when a user's presence flips offline -> online. */
export const onUserPresenceOnline = functions.firestore
  .document('users/{uid}')
  .onUpdate(async (change, context) => {
    initFirebaseAdmin();
    const before = (change.before.data() as any) || {};
    const after = (change.after.data() as any) || {};
    const wasOnline = before?.presence?.state === 'online';
    const isOnline = after?.presence?.state === 'online';
    if (wasOnline || !isOnline) return null; // only the offline->online edge
    const transitionId = after?.presence?.lastSeenAt || Date.now();
    await notifyOnlineWatchers(context.params.uid, transitionId);
    return null;
  });

/**
 * Mark stale 'online' sessions offline so the next foreground is a real
 * transition the trigger above can act on. Runs frequently and is cheap.
 */
export const presenceOfflineSweep = functions.pubsub
  .schedule('every 5 minutes')
  .onRun(async () => {
    initFirebaseAdmin();
    const db = admin.firestore();
    const cutoff = Date.now() - STALE_MS;
    try {
      const snap = await db
        .collection('users')
        .where('presence.lastSeenAt', '<', cutoff)
        .limit(SWEEP_LIMIT)
        .get();
      const stale = snap.docs.filter((d) => (d.data() as any)?.presence?.state === 'online');
      if (stale.length === 0) {
        return null;
      }
      const batch = db.batch();
      stale.forEach((d) => batch.update(d.ref, { 'presence.state': 'offline' }));
      await batch.commit();
      console.log(`[presenceWatch] swept ${stale.length} stale sessions offline`);
    } catch (e) {
      console.warn('[presenceWatch] sweep failed', (e as any)?.message || String(e));
    }
    return null;
  });
