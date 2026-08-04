// notificationsInboxService — the in-app view of the durable notification spine.
//
// The backend writes every push to notifications/{id} (the outbox). Those same
// docs are the user's catch-up inbox: a user can read their own and flip them to
// 'read'. This powers the Messages → Notifications tab (team requests, battles,
// internal messages, etc.).

import { firestore as db } from '../config/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

const toMs = (v) => {
  try {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    return new Date(v).getTime() || 0;
  } catch {
    return 0;
  }
};

/**
 * Subscribe to the current user's notifications, newest first. Uses a single
 * equality filter (auto-indexed) and sorts client-side to avoid a composite
 * index requirement.
 */
export function subscribeNotifications(uid, callback, max = 100) {
  if (!uid) {
    callback([]);
    return () => {};
  }
  try {
    const q = query(collection(db, 'notifications'), where('userId', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
          .slice(0, max);
        callback(items);
      },
      (err) => {
        console.warn('[notificationsInbox] subscribe error', err?.message || err);
        callback([]);
      }
    );
  } catch (e) {
    console.warn('[notificationsInbox] setup failed', e?.message || e);
    callback([]);
    return () => {};
  }
}

/** Mark a notification read (the only client-allowed mutation). */
export async function markNotificationRead(id) {
  if (!id) return;
  try {
    await updateDoc(doc(db, 'notifications', id), { status: 'read', readAt: serverTimestamp() });
  } catch (e) {
    // Non-fatal; the rules only permit status->read on your own docs.
    console.warn('[notificationsInbox] markRead failed', e?.message || e);
  }
}
