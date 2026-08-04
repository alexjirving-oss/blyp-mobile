import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

const CALL_STATUSES = new Set(['ringing', 'active', 'ended', 'missed', 'declined']);

function normalizeCall(d) {
  const data = d.data() || {};
  const participants = Array.isArray(data.participants)
    ? data.participants
    : Array.isArray(data.participantIds)
      ? data.participantIds
      : [];
  return {
    id: d.id,
    ...data,
    participants,
    participantIds: participants,
  };
}

export const messengerExtrasService = {
  subscribeToCalls(db, uid, onCalls, onError) {
    try {
      const callsRef = collection(db, 'calls');
      const q = query(callsRef, where('participants', 'array-contains', uid));
      return onSnapshot(
        q,
        (snapshot) => {
          const calls = snapshot.docs
            .map(normalizeCall)
            .filter((c) => Array.isArray(c.participants) && c.participants.includes(uid))
            .sort((a, b) => {
              const aMs = a.createdAt?.toMillis?.() || a.createdAtMs || 0;
              const bMs = b.createdAt?.toMillis?.() || b.createdAtMs || 0;
              return bMs - aMs;
            });
          onCalls(calls);
        },
        (err) => onError?.(err),
      );
    } catch (error) {
      onError?.(error);
      return () => {};
    }
  },

  subscribeToCall(db, callId, onCall, onError) {
    if (!callId) return () => {};
    try {
      return onSnapshot(
        doc(db, 'calls', callId),
        (snap) => {
          if (!snap.exists()) {
            onCall?.(null);
            return;
          }
          onCall?.(normalizeCall(snap));
        },
        (err) => onError?.(err),
      );
    } catch (error) {
      onError?.(error);
      return () => {};
    }
  },

  /**
   * Watch for inbound ringing calls for this user (app open / foreground).
   * Single-field query only (no composite index); filter status/callee client-side.
   */
  subscribeToIncomingCalls(db, uid, onIncoming, onError) {
    if (!uid) return () => {};
    try {
      const callsRef = collection(db, 'calls');
      const q = query(callsRef, where('participants', 'array-contains', uid));
      return onSnapshot(
        q,
        (snapshot) => {
          const incoming = snapshot.docs
            .map(normalizeCall)
            .filter(
              (c) =>
                c.calleeId === uid &&
                c.callerId !== uid &&
                String(c.status || '') === 'ringing',
            );
          onIncoming?.(incoming);
        },
        (err) => onError?.(err),
      );
    } catch (error) {
      onError?.(error);
      return () => {};
    }
  },

  async createCall(db, { callerId, calleeId, conversationId, callerName, calleeName }) {
    const caller = String(callerId || '').trim();
    const callee = String(calleeId || '').trim();
    if (!caller || !callee || caller === callee) {
      throw new Error('Invalid call participants');
    }
    const participants = [caller, callee];
    const ref = await addDoc(collection(db, 'calls'), {
      participants,
      participantIds: participants,
      callerId: caller,
      calleeId: callee,
      conversationId: conversationId ? String(conversationId) : null,
      callerName: callerName ? String(callerName) : '',
      calleeName: calleeName ? String(calleeName) : '',
      status: 'ringing',
      type: 'audio',
      livekitRoom: '', // filled with doc id after create
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      answeredAt: null,
      endedAt: null,
      endedBy: null,
    });
    // Room name === call id for stable LiveKit room naming.
    await updateDoc(ref, { livekitRoom: ref.id });
    return { id: ref.id, livekitRoom: ref.id };
  },

  async updateCallStatus(db, callId, status, extra = {}) {
    const next = String(status || '').toLowerCase();
    if (!CALL_STATUSES.has(next)) throw new Error(`Invalid call status: ${status}`);
    const payload = { status: next, ...extra };
    if (next === 'active' && !extra.answeredAt) {
      payload.answeredAt = serverTimestamp();
      payload.answeredAtMs = Date.now();
    }
    if ((next === 'ended' || next === 'missed' || next === 'declined') && !extra.endedAt) {
      payload.endedAt = serverTimestamp();
      payload.endedAtMs = Date.now();
    }
    await updateDoc(doc(db, 'calls', callId), payload);
  },

  subscribeToRecentStatuses(db, onStatuses, onError) {
    try {
      const statusesRef = collection(db, 'statuses');
      return onSnapshot(
        statusesRef,
        (snapshot) => {
          const statuses = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          onStatuses(statuses);
        },
        (err) => onError?.(err),
      );
    } catch (error) {
      onError?.(error);
      return () => {};
    }
  },
};
