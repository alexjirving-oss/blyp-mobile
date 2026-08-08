// notificationsInboxService — the in-app view of the durable notification spine.
//
// The backend writes every push to notifications/{id} (the outbox). Those same
// docs are the user's catch-up inbox: a user can read their own and flip them to
// 'read'. This powers the Messages → Notifications tab (team requests, battles,
// internal messages, etc.).
//
// On read we rewrite titles/bodies that still contain raw actor uids (legacy
// writes) by resolving users/{uid} (and userProfiles) to a public label.

import { firestore as db } from '../config/firebase';
import {
  collection,
  limit,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  looksLikeRawId,
  notificationTitleNeedsResolve,
  pickPublicLabel,
  replaceActorInText,
} from '../utils/publicLabel';

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

const labelCache = new Map();

function actorIdFromNotification(n) {
  const d = n?.data && typeof n.data === 'object' ? n.data : {};
  const candidates = [d.senderId, d.hostId, d.targetId, d.actorId, d.userId, n.actorId];
  for (const c of candidates) {
    const id = String(c || '').trim();
    if (id) return id;
  }
  // Title alone is sometimes the uid (DM sender).
  const title = String(n?.title || '').trim();
  if (looksLikeRawId(title)) return title;
  const first = title.split(/[\s·|]/)[0] || '';
  if (looksLikeRawId(first)) return first;
  return '';
}

async function resolveLabel(actorId) {
  const id = String(actorId || '').trim();
  if (!id) return '';
  if (labelCache.has(id)) return labelCache.get(id);
  try {
    const snap = await getDoc(doc(db, 'users', id));
    const d = snap.exists() ? snap.data() || {} : {};
    let label = pickPublicLabel(d, { uid: id, fallback: '' });
    if (!label) {
      const pSnap = await getDoc(doc(db, 'userProfiles', id));
      const p = pSnap.exists() ? pSnap.data() || {} : {};
      label = pickPublicLabel(p, { uid: id, fallback: '' });
    }
    label = label || 'Someone';
    labelCache.set(id, label);
    return label;
  } catch {
    labelCache.set(id, 'Someone');
    return 'Someone';
  }
}

async function enrichNotifications(items) {
  if (!Array.isArray(items) || items.length === 0) return items || [];
  const out = await Promise.all(
    items.map(async (n) => {
      try {
        const data = n?.data && typeof n.data === 'object' ? { ...n.data } : {};
        const actorId = actorIdFromNotification(n);
        const denorm = pickPublicLabel(
          {
            username: data.actorUsername || data.senderName || data.hostName || data.targetName,
            displayName: data.actorDisplayName || data.senderDisplayName,
          },
          { uid: actorId, fallback: '' }
        );
        const titleNeeds = notificationTitleNeedsResolve(n?.title, actorId);
        if (!titleNeeds && denorm) {
          return { ...n, actorId: actorId || n.actorId, actorUsername: denorm };
        }
        if (!titleNeeds && !actorId) return n;
        if (!actorId && !denorm) return n;

        const label = denorm || (actorId ? await resolveLabel(actorId) : 'Someone');
        const title = titleNeeds ? replaceActorInText(n.title || label, actorId, label) : n.title;
        const body =
          actorId && n?.body && String(n.body).includes(actorId)
            ? replaceActorInText(n.body, actorId, label)
            : n.body;
        return {
          ...n,
          actorId: actorId || n.actorId,
          actorUsername: label,
          title: title || label,
          body,
          data: {
            ...data,
            actorUsername: isUsableSender(data.actorUsername) ? data.actorUsername : label,
            senderName: isUsableSender(data.senderName) ? data.senderName : label,
          },
        };
      } catch {
        return n;
      }
    })
  );
  return out;
}

function isUsableSender(v) {
  const t = String(v || '').trim();
  return !!t && !looksLikeRawId(t);
}

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
    const notificationsRef = collection(db, 'notifications');
    const orderedQuery = query(
      notificationsRef,
      where('userId', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(max),
    );
    const fallbackQuery = query(notificationsRef, where('userId', '==', uid));
    let activeUnsubscribe = null;
    const onNext = (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((notification) => notification.status !== 'suppressed')
        .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
        .slice(0, max);
      // Immediate paint, then resolve opaque actor ids for the UI.
      callback(items);
      enrichNotifications(items)
        .then((enriched) => callback(enriched))
        .catch(() => {});
    };
    const subscribeFallback = () => onSnapshot(
      fallbackQuery,
      onNext,
      (err) => {
        console.warn('[notificationsInbox] fallback subscribe error', err?.message || err);
        callback([]);
      },
    );
    activeUnsubscribe = onSnapshot(
      orderedQuery,
      onNext,
      (err) => {
        const code = String(err?.code || '');
        const message = String(err?.message || '').toLowerCase();
        if (code === 'failed-precondition' || message.includes('index')) {
          try { activeUnsubscribe?.(); } catch {}
          activeUnsubscribe = subscribeFallback();
          return;
        }
        console.warn('[notificationsInbox] subscribe error', err?.message || err);
        callback([]);
      },
    );
    return () => {
      try { activeUnsubscribe?.(); } catch {}
    };
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
