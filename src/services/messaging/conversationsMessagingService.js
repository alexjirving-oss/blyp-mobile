import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  arrayUnion,
} from 'firebase/firestore';

import { getAuth } from 'firebase/auth';

function safeToDate(maybeTimestamp) {
  if (!maybeTimestamp) return null;
  if (typeof maybeTimestamp?.toDate === 'function') return maybeTimestamp.toDate();
  if (typeof maybeTimestamp === 'number') return new Date(maybeTimestamp);
  return null;
}

async function getConversationDoc(db, conversationId) {
  const ref = doc(db, 'conversations', conversationId);
  const snap = await getDoc(ref);
  return { ref, snap };
}

function getParticipantIds(conversation) {
  // Support both the production schema (`participantIds`) and legacy schema (`participants`).
  const ids =
    (Array.isArray(conversation?.participantIds) && conversation.participantIds) ||
    (Array.isArray(conversation?.participants) && conversation.participants) ||
    [];
  return ids.filter(Boolean);
}

function buildDmKey(a, b) {
  // Stable key for a direct message between two users.
  const s1 = String(a || '');
  const s2 = String(b || '');
  return [s1, s2].sort().join('__');
}

export const conversationsMessagingService = {
  subscribeToThreads(db, uid, onThreads, onError) {
    try {
      // [BLYP][PROD_DIAG] Log auth state at query time
      try {
        const fbAuth = getAuth();
        const fbUser = fbAuth?.currentUser;
        console.warn('[CONVERSATIONS][DIAG] subscribeToThreads', {
          queryUid: uid,
          fbAuthUid: fbUser?.uid || 'NULL',
          fbAuthMatch: fbUser?.uid === uid,
          isAnonymous: fbUser?.isAnonymous,
        });
      } catch (e) {
        console.warn('[CONVERSATIONS][DIAG] auth check failed:', e?.message);
      }
      const conversationsRef = collection(db, 'conversations');

      const orderedQuery = query(
        conversationsRef,
        where('participantIds', 'array-contains', uid),
        orderBy('lastMessageTime', 'desc'),
      );

      const fallbackQuery = query(conversationsRef, where('participantIds', 'array-contains', uid));

      const normalize = (snapshot) => {
        const threads = snapshot.docs
          .map((d) => {
            const data = d.data();
            return { id: d.id, ...data, participants: getParticipantIds(data) };
          })
          .filter((t) => getParticipantIds(t).includes(uid))
          .filter((t) => !t.deleted);

        threads.sort((a, b) => {
          const ad = safeToDate(a.lastMessageTime);
          const bd = safeToDate(b.lastMessageTime);
          const at = ad ? ad.getTime() : 0;
          const bt = bd ? bd.getTime() : 0;
          return bt - at;
        });

        onThreads(threads);
      };

      // Try ordered query first; if Firestore complains about missing composite indexes,
      // transparently fall back to a simpler query and sort client-side.
      let unsubscribeActive = null;

      const subscribeFallback = () =>
        onSnapshot(
          fallbackQuery,
          normalize,
          (e2) => {
            onError?.(e2);
          },
        );

      const subscribeOrdered = () =>
        onSnapshot(
          orderedQuery,
          normalize,
          (err) => {
            const msg = String(err?.message || err || '').toLowerCase();
            const code = String(err?.code || '').toLowerCase();
            const isIndexErr = code === 'failed-precondition' || msg.includes('requires an index') || msg.includes('index');

            if (isIndexErr) {
              try {
                if (typeof unsubscribeActive === 'function') unsubscribeActive();
              } catch (_) { }
              unsubscribeActive = subscribeFallback();
              // Don't surface as fatal; fallback should keep chats working.
              return;
            }

            onError?.(err);
          },
        );

      unsubscribeActive = subscribeOrdered();

      return () => {
        try {
          if (typeof unsubscribeActive === 'function') unsubscribeActive();
        } catch (_) { }
      };
    } catch (error) {
      onError?.(error);
      return () => { };
    }
  },

  subscribeToMessages(db, conversationId, onMessages, onError, pageSize = 50) {
    try {
      const messagesRef = collection(db, 'conversations', conversationId, 'messages');
      const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(pageSize));

      return onSnapshot(
        q,
        (snapshot) => {
          const messages = snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .reverse();
          onMessages(messages, {
            oldestCursor: snapshot.docs[snapshot.docs.length - 1] || null,
            hasMore: snapshot.docs.length === pageSize,
          });
        },
        (err) => onError?.(err),
      );
    } catch (error) {
      onError?.(error);
      return () => { };
    }
  },

  async loadOlderMessages(db, conversationId, oldestCursor, pageSize = 50) {
    if (!conversationId || !oldestCursor) return { messages: [], oldestCursor: null, hasMore: false };
    const messagesRef = collection(db, 'conversations', conversationId, 'messages');
    const q = query(
      messagesRef,
      orderBy('timestamp', 'desc'),
      startAfter(oldestCursor),
      limit(pageSize),
    );
    const snapshot = await getDocs(q);
    return {
      messages: snapshot.docs.map((d) => ({ id: d.id, ...d.data() })).reverse(),
      oldestCursor: snapshot.docs[snapshot.docs.length - 1] || oldestCursor,
      hasMore: snapshot.docs.length === pageSize,
    };
  },

  async createOrGetDirectThread(db, uid, otherUserId, meName, otherName, options = {}) {
    if (!uid || !otherUserId) {
      throw new Error('createOrGetDirectThread requires uid and otherUserId');
    }
    if (String(uid) === String(otherUserId)) {
      throw new Error('Cannot start a direct chat with yourself');
    }
    // [BLYP][PROD_DIAG] Log auth state at query time
    try {
      const fbAuth = getAuth();
      const fbUser = fbAuth?.currentUser;
      console.warn('[CONVERSATIONS][DIAG] createOrGetDirectThread', {
        queryUid: uid,
        otherUserId,
        fbAuthUid: fbUser?.uid || 'NULL',
        fbAuthMatch: fbUser?.uid === uid,
      });
    } catch (e) {
      console.warn('[CONVERSATIONS][DIAG] auth check failed:', e?.message);
    }
    const conversationsRef = collection(db, 'conversations');

    // Firestore can't query array-contains for two different values in one query.
    // We query for uid and then filter client-side.
    const q = query(conversationsRef, where('participantIds', 'array-contains', uid));
    const snap = await getDocs(q);

    const existing = snap.docs
      .map((d) => {
        const data = d.data();
        return { id: d.id, ...data, participants: getParticipantIds(data) };
      })
      .find((c) => {
        if (c.deleted) return false;
        const participants = getParticipantIds(c);
        const isDirect = participants.length === 2;
        return isDirect && participants.includes(uid) && participants.includes(otherUserId);
      });

    if (existing?.id) {
      if (options.context) {
        try {
          await updateDoc(doc(db, 'conversations', existing.id), {
            contexts: arrayUnion(String(options.context)),
            ...(options.matchId ? { datingMatchId: String(options.matchId) } : {}),
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Context is presentation metadata; never block an existing DM from opening.
        }
      }
      return existing.id;
    }

    // Production-hardened schema (required by firestore.rules):
    // - type: 'dm'
    // - participantIds: [uid, otherUserId]
    // - dmKey: stable key
    // - createdAt/updatedAt: timestamps
    const createdAt = serverTimestamp();
    const created = await addDoc(conversationsRef, {
      type: 'dm',
      dmKey: buildDmKey(uid, otherUserId),
      participantIds: [uid, otherUserId],

      // Extras used by the UI; rules allow additional fields.
      participantNames: [meName, otherName],
      contexts: options.context ? [String(options.context)] : [],
      ...(options.matchId ? { datingMatchId: String(options.matchId) } : {}),
      unreadCount: {
        [uid]: 0,
        [otherUserId]: 0,
      },
      lastMessage: '',
      lastMessageTime: createdAt,
      createdAt,
      updatedAt: createdAt,
      deleted: false,
    });

    return created.id;
  },

  async sendMessage(db, conversationId, senderId, senderName, text) {
    return this.sendStructuredMessage(db, conversationId, senderId, senderName, {
      text,
      type: 'text',
    });
  },

  async sendGiftMessage(db, conversationId, senderId, senderName, gift) {
    const giftName = String(gift?.name || 'Gift');
    const emoji = String(gift?.emoji || '🎁');
    const coinCost = Math.max(0, Number(gift?.coinCost || gift?.cost || 0));
    return this.sendStructuredMessage(db, conversationId, senderId, senderName, {
      text: `${emoji} Sent ${giftName}`,
      type: 'gift',
      giftId: String(gift?.giftId || ''),
      giftName,
      giftEmoji: emoji,
      coinCost,
    });
  },

  async sendStructuredMessage(db, conversationId, senderId, senderName, payload) {
    const messagesRef = collection(db, 'conversations', conversationId, 'messages');
    const { ref: conversationRef, snap } = await getConversationDoc(db, conversationId);
    const conversation = snap.exists() ? snap.data() : null;
    const text = String(payload?.text || '').trim();

    // Create message
    await addDoc(messagesRef, {
      senderId,
      senderName,
      text,
      ...payload,
      type: payload?.type || 'text',
      createdAt: serverTimestamp(),
      timestamp: serverTimestamp(),
      status: 'sent',
    });

    const participants = getParticipantIds(conversation);

    const unreadUpdates = {};
    for (const participantId of participants) {
      if (!participantId || participantId === senderId) continue;
      unreadUpdates[`unreadCount.${participantId}`] = increment(1);
    }

    // Ensure sender unread count doesn't drift upward.
    unreadUpdates[`unreadCount.${senderId}`] = 0;

    await updateDoc(conversationRef, {
      lastMessage: text,
      lastMessageTime: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...unreadUpdates,
    });
  },

  async markMessagesRead(db, conversationId, readerId, messageIds) {
    // Per-message status updates are blocked by Firestore rules
    // (`allow update, delete: if false` on conversations/.../messages).
    // Prefer markThreadRead / markThreadDelivered + conversation-level stamps.
    if (!Array.isArray(messageIds) || messageIds.length === 0) return;
    const updates = messageIds.map((id) => {
      const ref = doc(db, 'conversations', conversationId, 'messages', id);
      return updateDoc(ref, { status: 'read', readAt: serverTimestamp(), readBy: readerId });
    });
    await Promise.all(updates);
  },

  /**
   * Live conversation doc (lastReadAt / lastDeliveredAt / unreadCount).
   * Used for WhatsApp-style outbound ticks without per-message writes.
   */
  subscribeToConversation(db, conversationId, onConversation, onError) {
    if (!conversationId) return () => {};
    try {
      const ref = doc(db, 'conversations', conversationId);
      return onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) {
            onConversation?.(null);
            return;
          }
          onConversation?.({ id: snap.id, ...snap.data() });
        },
        (err) => onError?.(err),
      );
    } catch (error) {
      onError?.(error);
      return () => {};
    }
  },

  /** Recipient device has the latest messages (double grey ticks for sender). */
  async markThreadDelivered(db, conversationId, recipientId) {
    if (!conversationId || !recipientId) return;
    const conversationRef = doc(db, 'conversations', conversationId);
    await updateDoc(conversationRef, {
      [`lastDeliveredAt.${recipientId}`]: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  async markThreadRead(db, conversationId, readerId) {
    const conversationRef = doc(db, 'conversations', conversationId);
    await updateDoc(conversationRef, {
      [`unreadCount.${readerId}`]: 0,
      [`lastReadAt.${readerId}`]: serverTimestamp(),
      // Opening the thread also counts as delivered.
      [`lastDeliveredAt.${readerId}`]: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },
};

/** Epoch ms from Firestore Timestamp / Date / number / {seconds}. */
export function firestoreTimeMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') {
    const n = value.toMillis();
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    const n = d?.getTime?.();
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Seconds vs ms — conversation stamps are ms-scale server times.
    return value < 1e12 ? value * 1000 : value;
  }
  if (value instanceof Date) {
    const n = value.getTime();
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value?.seconds === 'number') {
    const nano = typeof value.nanoseconds === 'number' ? value.nanoseconds : 0;
    return value.seconds * 1000 + Math.floor(nano / 1e6);
  }
  return 0;
}

/**
 * WhatsApp-style outbound receipt from conversation-level peer stamps.
 * @returns {'sent'|'delivered'|'read'}
 */
export function outboundReceiptStatus(message, peerLastDeliveredAt, peerLastReadAt) {
  const msgTs = firestoreTimeMs(message?.timestamp || message?.createdAt);
  const readAt = firestoreTimeMs(peerLastReadAt);
  const deliveredAt = firestoreTimeMs(peerLastDeliveredAt);

  if (msgTs > 0 && readAt > 0 && msgTs <= readAt) return 'read';
  if (msgTs > 0 && deliveredAt > 0 && msgTs <= deliveredAt) return 'delivered';

  const raw = String(message?.status || 'sent').toLowerCase();
  if (raw === 'read') return 'read';
  if (raw === 'delivered') return 'delivered';
  return 'sent';
}

async function upsertConversationIndex({ threadId, participantIds, lastMessageText, lastSenderUid }){
  const { doc, setDoc, serverTimestamp } = require("firebase/firestore");
  const { db } = require("../../config/firebase"); // best-effort; adjust if your export differs
  const ref = doc(db, "conversations", threadId);
  await setDoc(ref, {
    threadId,
    participantIds,
    lastMessageText: lastMessageText || "",
    lastsenderUid: lastSenderUid || null,
      senderDisplayName: (senderProfile && senderProfile.displayName) ? senderProfile.displayName : null,
      senderUsername: (senderProfile && senderProfile.username) ? senderProfile.username : null,
      senderPhotoURL: (senderProfile && senderProfile.photoURL) ? senderProfile.photoURL : null,
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  console.warn("[BLYP][CONVO_INDEX] OK thread=" + threadId);
}

// [BLYP][SENDER_SNAPSHOT]

