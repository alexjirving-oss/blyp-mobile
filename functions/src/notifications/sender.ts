/**
 * Sender — turns a notification into real device pushes via FCM.
 *
 * Reads the recipient's registered devices (users/{uid}/devices/*), sends a
 * multicast, and prunes tokens FCM reports as permanently invalid so the
 * registry self-heals. Returns a structured result so the dispatcher can decide
 * sent / retry / dead — it never swallows outcomes (the "never silent" rule).
 */

import { admin } from '../firebaseAdmin';
import { NOTIF_COLLECTIONS } from './types';

export interface SendResult {
  deviceCount: number; // tokens we attempted
  successCount: number;
  failureCount: number;
  prunedTokens: number;
  /** true when the only failures were transient (worth retrying). */
  retriable: boolean;
}

const PERMANENT_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

interface DeviceRow {
  ref: FirebaseFirestore.DocumentReference;
  token: string;
}

async function loadDevices(userId: string): Promise<DeviceRow[]> {
  const db = admin.firestore();
  const rows: DeviceRow[] = [];
  const seen = new Set<string>();

  const collect = (snap: FirebaseFirestore.QuerySnapshot) => {
    for (const d of snap.docs) {
      const data = d.data() as any;
      const token = String(data?.pushToken || data?.token || '').trim();
      if (!token || data?.disabled === true) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      rows.push({ ref: d.ref, token });
    }
  };

  // Primary: users/{uid}/devices (PushService)
  const devicesSnap = await db
    .collection('users')
    .doc(userId)
    .collection(NOTIF_COLLECTIONS.devicesSub)
    .get();
  collect(devicesSnap);

  // Fallback: legacy deviceTokens collection (older rules / clients)
  if (rows.length === 0) {
    const legacySnap = await db
      .collection('users')
      .doc(userId)
      .collection('deviceTokens')
      .get();
    collect(legacySnap);
  }

  return rows;
}

export interface SendPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  collapseKey?: string;
}

export async function sendToUser(userId: string, payload: SendPayload): Promise<SendResult> {
  const devices = await loadDevices(userId);
  if (devices.length === 0) {
    return { deviceCount: 0, successCount: 0, failureCount: 0, prunedTokens: 0, retriable: false };
  }

  const tokens = devices.map((d) => d.token);
  const dataType = String(payload.data?.type || '').toLowerCase();
  const isCall = dataType === 'incoming_call' || dataType === 'call';

  // Incoming calls: data-first + dedicated MAX channel so lock-screen / pocket
  // still rings loudly. Title/body also go in data so our native handler can
  // build a full-screen call notification when the process is awake.
  const data: Record<string, string> = {
    ...(payload.data || {}),
    title: payload.title,
    body: payload.body,
  };

  const message: admin.messaging.MulticastMessage = isCall
    ? {
        // DATA-ONLY + high priority so Android wakes our MessagingService when
        // the app is backgrounded/killed. A `notification` block would be
        // displayed by the OS without running native code (no full-screen ring).
        tokens,
        data,
        android: {
          priority: 'high',
          ttl: 60 * 1000,
          collapseKey: payload.collapseKey,
        },
        apns: {
          headers: {
            'apns-priority': '10',
            'apns-push-type': 'alert',
            ...(payload.collapseKey ? { 'apns-collapse-id': payload.collapseKey } : {}),
          },
          payload: {
            aps: {
              alert: { title: payload.title, body: payload.body },
              sound: 'blyp_notify.wav',
              'interruption-level': 'time-sensitive',
              contentAvailable: true,
            },
            ...data,
          },
        },
      }
    : {
        tokens,
        notification: { title: payload.title, body: payload.body },
        data,
        android: {
          priority: 'high',
          collapseKey: payload.collapseKey,
          notification: {
            channelId: 'blyp',
            sound: 'blyp_notify',
          },
        },
        apns: {
          headers: {
            'apns-priority': '10',
            'apns-push-type': 'alert',
            ...(payload.collapseKey ? { 'apns-collapse-id': payload.collapseKey } : {}),
          },
          payload: { aps: { sound: 'blyp_notify.wav' } },
        },
      };

  const resp = await admin.messaging().sendEachForMulticast(message);

  let pruned = 0;
  let transientFailures = 0;
  const prunePromises: Promise<unknown>[] = [];
  resp.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code || '';
    if (PERMANENT_TOKEN_ERRORS.has(code)) {
      pruned += 1;
      prunePromises.push(devices[i].ref.delete().catch(() => undefined));
    } else {
      transientFailures += 1;
    }
  });
  if (prunePromises.length) await Promise.all(prunePromises);

  return {
    deviceCount: tokens.length,
    successCount: resp.successCount,
    failureCount: resp.failureCount,
    prunedTokens: pruned,
    // Retriable only if nothing succeeded AND at least one failure was transient.
    retriable: resp.successCount === 0 && transientFailures > 0,
  };
}
