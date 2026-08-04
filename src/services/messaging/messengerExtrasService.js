import { collection, onSnapshot, query, where } from 'firebase/firestore';

export const messengerExtrasService = {
  subscribeToCalls(db, uid, onCalls, onError) {
    try {
      // Query by participant to satisfy common security rules (and avoid reading entire collection).
      // No composite index required for a single array-contains.
      const callsRef = collection(db, 'calls');
      const q = query(callsRef, where('participants', 'array-contains', uid));
      return onSnapshot(
        q,
        (snapshot) => {
          const calls = snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((c) => {
              const participants = c?.participants;
              return Array.isArray(participants) ? participants.includes(uid) : false;
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

  subscribeToRecentStatuses(db, onStatuses, onError) {
    try {
      // Same approach: avoid orderBy/where combos that might need indexes.
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
