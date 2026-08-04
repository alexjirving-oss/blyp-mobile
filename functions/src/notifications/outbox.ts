/**
 * Outbox — the only sanctioned way to create a notification.
 *
 * enqueue() is idempotent: the doc id is a hash of the dedupeKey, so the same
 * logical event enqueued twice collapses to a single durable record. This is the
 * "never wrong / never double-fire" guarantee at the point of creation.
 */

import * as crypto from 'crypto';
import { admin } from '../firebaseAdmin';
import {
  DEFAULT_MAX_ATTEMPTS,
  NOTIF_COLLECTIONS,
  NotificationDoc,
  NotificationType,
} from './types';

export interface EnqueueInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  dedupeKey: string;
  data?: Record<string, string>;
  collapseKey?: string;
  /** epoch ms; defaults to now (send immediately). */
  sendAfter?: number;
  maxAttempts?: number;
}

export function notificationIdFor(dedupeKey: string): string {
  return 'n_' + crypto.createHash('sha1').update(dedupeKey).digest('hex').slice(0, 32);
}

/**
 * Create a queued notification if one doesn't already exist for this dedupeKey.
 * Returns true if newly created, false if it already existed (idempotent no-op).
 */
export async function enqueueNotification(input: EnqueueInput): Promise<boolean> {
  const db = admin.firestore();
  const id = notificationIdFor(input.dedupeKey);
  const now = Date.now();

  const doc: NotificationDoc = {
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    data: input.data || {},
    dedupeKey: input.dedupeKey,
    collapseKey: input.collapseKey,
    status: 'queued',
    sendAfter: typeof input.sendAfter === 'number' ? input.sendAfter : now,
    attempts: 0,
    maxAttempts: input.maxAttempts || DEFAULT_MAX_ATTEMPTS,
    nextAttemptAt: 0,
    createdAt: now,
  };

  const ref = db.collection(NOTIF_COLLECTIONS.notifications).doc(id);
  try {
    // create() throws ALREADY_EXISTS if the doc is present → idempotent.
    await ref.create(doc as any);
    return true;
  } catch (e: any) {
    const code = e?.code || e?.status;
    if (code === 6 || code === 'already-exists' || /already exists/i.test(String(e?.message))) {
      return false;
    }
    throw e;
  }
}
