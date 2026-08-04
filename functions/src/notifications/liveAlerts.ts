/**
 * Live alerts — the spine's first real payload.
 *
 * When a stream transitions into `live`, fan a "someone you follow is live" push
 * out to the host's followers. This is the lowest-stakes, highest-intent trigger
 * (the data already exists) and proves the pipe under real load before anything
 * appointment-critical rides on it.
 *
 * Safety:
 *  - Fires at most once per stream (guarded by a transactional `liveAlertSentAt`
 *    stamp on the stream doc).
 *  - Each recipient enqueue is idempotent via dedupeKey `live:<streamId>:<uid>`,
 *    so even a retried trigger can't double-notify.
 */

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { enqueueNotification } from './outbox';

const MAX_FOLLOWERS_FANOUT = 5000;
const ENQUEUE_CHUNK = 50;

async function resolveHostName(hostUid: string): Promise<string> {
  const db = admin.firestore();
  try {
    const u = await db.collection('users').doc(hostUid).get();
    const d = (u.data() as any) || {};
    const name = d.displayName || d.username || d.name;
    if (name) return String(name);
  } catch {
    // fall through
  }
  try {
    const p = await db.collection('userProfiles').doc(hostUid).get();
    const d = (p.data() as any) || {};
    const name = d.displayName || d.username || d.name;
    if (name) return String(name);
  } catch {
    // fall through
  }
  return 'Someone you follow';
}

async function claimLiveAlert(streamId: string): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.collection('liveStreams').doc(streamId);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const d = snap.data() as any;
      if (d.liveAlertSentAt) return false; // already fanned out
      tx.update(ref, { liveAlertSentAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
  } catch {
    return false;
  }
}

/**
 * Per-user opt-in: anyone who asked "notify me when <host> is next live" via the
 * blyp bar. These are one-shot — we notify, then deactivate the watch so it
 * doesn't fire on the host's next stream.
 */
async function notifyLiveWatchers(
  hostUid: string,
  streamId: string,
  title: string,
  body: string
): Promise<void> {
  const db = admin.firestore();
  let snap;
  try {
    snap = await db.collection('userWatches').where('key', '==', `${hostUid}__live`).get();
  } catch (e) {
    console.warn('[liveAlerts] watch query failed', (e as any)?.message || String(e));
    return;
  }

  const watches = snap.docs.filter((d) => (d.data() as any)?.active !== false);
  if (watches.length === 0) return;

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
          type: 'live',
          title,
          body,
          dedupeKey: `livewatch:${streamId}:${watcherUid}`,
          collapseKey: `livewatch:${streamId}`,
          data: { type: 'live', streamId, hostId: hostUid },
        }).catch(() => false);
      })
    );
    enqueued += results.filter(Boolean).length;

    // Deactivate this chunk's watches (one-shot).
    // eslint-disable-next-line no-await-in-loop
    const batch = db.batch();
    chunk.forEach((doc) => batch.update(doc.ref, { active: false, firedAt: admin.firestore.FieldValue.serverTimestamp() }));
    // eslint-disable-next-line no-await-in-loop
    await batch.commit().catch(() => {});
  }

  console.log(`[liveAlerts] stream ${streamId}: notified ${enqueued} live-watchers`);
}

async function fanOutLiveAlert(streamId: string, stream: any): Promise<void> {
  const hostUid = String(stream?.userId || '').trim();
  if (!hostUid) return;

  // One-shot guard.
  const shouldFire = await claimLiveAlert(streamId);
  if (!shouldFire) return;

  const db = admin.firestore();
  const hostName = await resolveHostName(hostUid);
  const title = `${hostName} is live`;
  const body = String(stream?.title || '').trim() || 'Tap to watch now';

  // Opt-in watchers first — they asked specifically for this host, and should be
  // notified even if the host has no followers.
  await notifyLiveWatchers(hostUid, streamId, title, body);

  const followersSnap = await db
    .collection('users')
    .doc(hostUid)
    .collection('followers')
    .limit(MAX_FOLLOWERS_FANOUT)
    .get();

  const followerIds = followersSnap.docs.map((d) => d.id).filter((id) => id && id !== hostUid);
  if (followerIds.length === 0) {
    console.log(`[liveAlerts] stream ${streamId}: host has no followers`);
    return;
  }

  let enqueued = 0;
  for (let i = 0; i < followerIds.length; i += ENQUEUE_CHUNK) {
    const chunk = followerIds.slice(i, i + ENQUEUE_CHUNK);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      chunk.map((uid) =>
        enqueueNotification({
          userId: uid,
          type: 'live',
          title,
          body,
          dedupeKey: `live:${streamId}:${uid}`,
          collapseKey: `live:${streamId}`,
          data: { type: 'live', streamId, hostId: hostUid },
        }).catch(() => false)
      )
    );
    enqueued += results.filter(Boolean).length;
  }

  console.log(`[liveAlerts] stream ${streamId}: enqueued ${enqueued}/${followerIds.length} alerts`);
}

export const onLiveStreamCreate = functions.firestore
  .document('liveStreams/{streamId}')
  .onCreate(async (snap, context) => {
    initFirebaseAdmin();
    const stream = snap.data();
    if (stream?.status === 'live') {
      await fanOutLiveAlert(context.params.streamId, stream);
    }
    return null;
  });

export const onLiveStreamGoLive = functions.firestore
  .document('liveStreams/{streamId}')
  .onUpdate(async (change, context) => {
    initFirebaseAdmin();
    const before = change.before.data();
    const after = change.after.data();
    if (before?.status !== 'live' && after?.status === 'live') {
      await fanOutLiveAlert(context.params.streamId, after);
    }
    return null;
  });
