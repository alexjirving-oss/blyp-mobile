/**
 * Battle notifications — invites, accept/reject/cancel, supporter broadcast, and
 * viewer reminders. All delivery rides the shared outbox + dispatcher + FCM spine
 * (idempotent via dedupeKey, durable, retried), so it works with the app closed.
 *
 *  - onBattleCreate     : push the invite to the opponent.
 *  - onBattleStatusChange: accept/reject/cancel notices + one-shot supporter fan-out.
 *  - onBattleReminderCreate: turn a viewer's "remind me" into a scheduled push.
 */

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { enqueueNotification } from '../notifications/outbox';

const ENQUEUE_CHUNK = 50;
const MAX_FOLLOWERS_FANOUT = 5000;

async function resolveName(uid: string): Promise<string> {
  const db = admin.firestore();
  try {
    const u = await db.collection('users').doc(uid).get();
    const d = (u.data() as any) || {};
    const name = d.displayName || d.username || d.name;
    if (name) return String(name);
  } catch {
    // fall through
  }
  return 'Someone';
}

function whenLabel(ms: number): string {
  try {
    const d = new Date(ms);
    return d.toLocaleString('en-GB', {
      weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
    });
  } catch {
    return 'soon';
  }
}

/** Fan a notice out to a host's followers, chunked and idempotent per recipient. */
async function fanOutToFollowers(
  hostUid: string,
  battleId: string,
  title: string,
  body: string
): Promise<number> {
  const db = admin.firestore();
  let snap;
  try {
    snap = await db.collection('users').doc(hostUid).collection('followers').limit(MAX_FOLLOWERS_FANOUT).get();
  } catch {
    return 0;
  }
  const ids = snap.docs.map((d) => d.id).filter((id) => id && id !== hostUid);
  let enqueued = 0;
  for (let i = 0; i < ids.length; i += ENQUEUE_CHUNK) {
    const chunk = ids.slice(i, i + ENQUEUE_CHUNK);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      chunk.map((uid) =>
        enqueueNotification({
          userId: uid,
          type: 'battle',
          title,
          body,
          dedupeKey: `battle_scheduled:${battleId}:${uid}`,
          collapseKey: `battle_scheduled:${battleId}`,
          data: { type: 'battle_scheduled', battleId },
        }).catch(() => false)
      )
    );
    enqueued += results.filter(Boolean).length;
  }
  return enqueued;
}

/** Fan battle-live notices to users who opted in via eventWatches. */
async function fanOutToBattleWatchers(
  battleId: string,
  title: string,
  body: string,
  excludeUids: string[] = []
): Promise<number> {
  const db = admin.firestore();
  let snap;
  try {
    snap = await db
      .collection('eventWatches')
      .where('type', '==', 'battle')
      .limit(MAX_FOLLOWERS_FANOUT)
      .get();
  } catch {
    return 0;
  }
  const exclude = new Set(excludeUids.filter(Boolean));
  const ids = snap.docs
    .map((d) => ({ uid: String((d.data() as any)?.watcherUid || ''), active: (d.data() as any)?.active }))
    .filter((row) => row.uid && row.active !== false && !exclude.has(row.uid))
    .map((row) => row.uid);
  let enqueued = 0;
  for (let i = 0; i < ids.length; i += ENQUEUE_CHUNK) {
    const chunk = ids.slice(i, i + ENQUEUE_CHUNK);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      chunk.map((uid) =>
        enqueueNotification({
          userId: uid,
          type: 'battle',
          title,
          body,
          dedupeKey: `battle_live_watch:${battleId}:${uid}`,
          collapseKey: `battle_live:${battleId}`,
          data: { type: 'battle_live', battleId },
        }).catch(() => false)
      )
    );
    enqueued += results.filter(Boolean).length;
  }
  return enqueued;
}

/** One-shot guard so supporter fan-out can't fire twice for the same battle. */
async function claimSupporterFanout(battleId: string): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.collection('battles').doc(battleId);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const d = snap.data() as any;
      if (d.supportersNotifiedAt) return false;
      tx.update(ref, { supportersNotifiedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
  } catch {
    return false;
  }
}

export const onBattleCreate = functions.firestore
  .document('battles/{battleId}')
  .onCreate(async (snap, context) => {
    initFirebaseAdmin();
    const b = snap.data() as any;
    if (!b || b.status !== 'pending' || !b.opponentUid) return null;
    const creatorName = b.creatorName || (await resolveName(b.creatorUid));
    const stakeNote = Number(b.stakeCoins) > 0 ? ` (${b.stakeCoins} coin battle)` : '';
    await enqueueNotification({
      userId: b.opponentUid,
      type: 'battle',
      title: `${creatorName} challenged you to a battle`,
      body: `Tap to accept or decline${stakeNote}`,
      dedupeKey: `battle_invite:${context.params.battleId}`,
      collapseKey: `battle_invite:${context.params.battleId}`,
      data: { type: 'battle_invite', battleId: context.params.battleId },
    });
    return null;
  });

export const onBattleStatusChange = functions.firestore
  .document('battles/{battleId}')
  .onUpdate(async (change, context) => {
    initFirebaseAdmin();
    const before = (change.before.data() as any) || {};
    const after = (change.after.data() as any) || {};
    const battleId = context.params.battleId;
    if (before.status === after.status) return null;

    // Accepted -> notify creator + (optionally) fan out to both fanbases.
    if (before.status === 'pending' && after.status === 'scheduled') {
      const opponentName = after.opponentName || (await resolveName(after.opponentUid));
      await enqueueNotification({
        userId: after.creatorUid,
        type: 'battle',
        title: `${opponentName} accepted your battle`,
        body: `Battle ${whenLabel(Number(after.scheduledStartAt))} UTC`,
        dedupeKey: `battle_accepted:${battleId}`,
        collapseKey: `battle:${battleId}`,
        data: { type: 'battle', battleId },
      });

      if (after.notifySupporters !== false) {
        const claimed = await claimSupporterFanout(battleId);
        if (claimed) {
          const title = `${after.creatorName} vs ${after.opponentName}`;
          const body = `Battle ${whenLabel(Number(after.scheduledStartAt))} UTC — tap to set a reminder`;
          await fanOutToFollowers(after.creatorUid, battleId, title, body);
          await fanOutToFollowers(after.opponentUid, battleId, title, body);
        }
      }
      return null;
    }

    // Declined -> notify creator.
    if (before.status === 'pending' && after.status === 'rejected') {
      const opponentName = after.opponentName || (await resolveName(after.opponentUid));
      await enqueueNotification({
        userId: after.creatorUid,
        type: 'battle',
        title: `${opponentName} declined your battle`,
        body: 'Try challenging someone else.',
        dedupeKey: `battle_rejected:${battleId}`,
        collapseKey: `battle:${battleId}`,
        data: { type: 'battle', battleId },
      });
      return null;
    }

    // Cancelled -> notify the other participant.
    if ((before.status === 'pending' || before.status === 'scheduled') && after.status === 'cancelled') {
      // Notify both participants; idempotent dedupe keys keep it clean.
      const title = 'Battle cancelled';
      const body = `${after.creatorName} vs ${after.opponentName} was called off.`;
      await Promise.all([
        enqueueNotification({
          userId: after.creatorUid, type: 'battle', title, body,
          dedupeKey: `battle_cancelled:${battleId}:${after.creatorUid}`,
          collapseKey: `battle:${battleId}`, data: { type: 'battle', battleId },
        }).catch(() => false),
        enqueueNotification({
          userId: after.opponentUid, type: 'battle', title, body,
          dedupeKey: `battle_cancelled:${battleId}:${after.opponentUid}`,
          collapseKey: `battle:${battleId}`, data: { type: 'battle', battleId },
        }).catch(() => false),
      ]);
      return null;
    }

    // Went live -> nudge both participants (viewers are covered by their reminders).
    if (before.status !== 'live' && after.status === 'live') {
      const title = 'Your battle is live';
      const body = `${after.creatorName} vs ${after.opponentName}`;
      await Promise.all([
        enqueueNotification({
          userId: after.creatorUid, type: 'battle', title, body,
          dedupeKey: `battle_live:${battleId}:${after.creatorUid}`,
          collapseKey: `battle_live:${battleId}`, data: { type: 'battle', battleId },
        }).catch(() => false),
        enqueueNotification({
          userId: after.opponentUid, type: 'battle', title, body,
          dedupeKey: `battle_live:${battleId}:${after.opponentUid}`,
          collapseKey: `battle_live:${battleId}`, data: { type: 'battle', battleId },
        }).catch(() => false),
      ]);
      await fanOutToBattleWatchers(
        battleId,
        'A battle is live on Blyp',
        body,
        [after.creatorUid, after.opponentUid]
      );
      return null;
    }

    return null;
  });

/**
 * A viewer opted into a reminder: schedule a push for `leadMinutes` before the
 * battle starts using the outbox's future-delivery (sendAfter). Idempotent.
 */
export const onBattleReminderCreate = functions.firestore
  .document('battles/{battleId}/reminders/{reminderUid}')
  .onCreate(async (snap, context) => {
    initFirebaseAdmin();
    const r = (snap.data() as any) || {};
    const battleId = context.params.battleId;
    const uid = context.params.reminderUid;

    const db = admin.firestore();
    const battleSnap = await db.collection('battles').doc(battleId).get();
    const b = (battleSnap.data() as any) || {};
    const startAt = Number(b.scheduledStartAt || r.scheduledStartAt || 0);
    if (!startAt) return null;

    const lead = Math.max(0, Math.round(Number(r.leadMinutes) || 0));
    const sendAfter = startAt - lead * 60 * 1000;
    const label = b.title || `${b.creatorName || 'A creator'} vs ${b.opponentName || 'an opponent'}`;

    await enqueueNotification({
      userId: uid,
      type: 'battle',
      title: lead > 0 ? `Battle starts soon` : `Battle starting now`,
      body: `${label} — tap to watch`,
      dedupeKey: `battle_remind:${battleId}:${uid}:${lead}`,
      collapseKey: `battle_remind:${battleId}`,
      sendAfter: Math.max(sendAfter, Date.now()),
      data: { type: 'battle_start', battleId },
    });
    return null;
  });
