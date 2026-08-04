// matchdayChatService
//
// Match-scoped live banter, following the ChatRoomService pattern (Firestore
// onSnapshot + addDoc + serverTimestamp). Messages live in their own collection
// keyed by `roomId` = `matchday:{eventId}` so banter never leaks into general
// chat rooms and is trivially scoped per fixture.

import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, firestore as db } from '../config/firebase';

const COLLECTION = 'matchdayMessages';
const MAX_LEN = 280;

class MatchdayChatService {
  get currentUser() {
    return auth?.currentUser || null;
  }

  // Subscribe to banter for a match room (chronological, capped).
  subscribeToRoom(roomId, callback) {
    if (!roomId) {
      callback([]);
      return () => {};
    }
    const q = query(
      collection(db, COLLECTION),
      where('roomId', '==', roomId),
      orderBy('timestamp', 'desc'),
      limit(120)
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const messages = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          messages.push({
            id: doc.id,
            ...data,
            timestamp: data.timestamp?.toDate?.() || new Date(),
          });
        });
        messages.reverse();
        callback(messages);
      },
      (error) => {
        console.warn('[MATCHDAY_CHAT] subscribe failed', error?.message || error);
        callback([]);
      }
    );
  }

  async sendMessage(roomId, text) {
    const user = this.currentUser;
    if (!user) throw new Error('Sign in to join the banter');
    const clean = String(text || '').trim().slice(0, MAX_LEN);
    if (!clean) return null;

    const message = {
      roomId,
      text: clean,
      type: 'text',
      senderId: user.uid,
      senderName: user.displayName || 'Fan',
      senderPhoto: user.photoURL || null,
      timestamp: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, COLLECTION), message);
    return ref.id;
  }
}

export default new MatchdayChatService();
