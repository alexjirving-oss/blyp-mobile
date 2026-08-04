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
  const snap = await db
    .collection('users')
    .doc(userId)
    .collection(NOTIF_COLLECTIONS.devicesSub)
    .get();
  const rows: DeviceRow[] = [];
  for (const d of snap.docs) {
    const data = d.data() as any;
    const token = String(data?.pushToken || data?.token || '').trim();
    if (token && data?.disabled !== true) {
      rows.push({ ref: d.ref, token });
    }
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
  const message: admin.messaging.MulticastMessage = {
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: payload.data || {},
    android: {
      priority: 'high',
      collapseKey: payload.collapseKey,
      notification: {
        channelId: 'blyp',
        // Resource in android/.../res/raw/blyp_notify.wav (filename, no extension).
        sound: 'blyp_notify',
      },
    },
    apns: {
      headers: {
        // Priority 10 = deliver immediately as a user-visible alert (the
        // default of 5 lets iOS coalesce/delay for power, which reads as "slow").
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
