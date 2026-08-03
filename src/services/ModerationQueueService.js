// ModerationQueueService — client reads only.
// Writes are server/rules-locked (Firestore deny); this module fails closed on mutations.

import { db } from '../config/firebase';

class ModerationQueueService {
  subscribe(callback, limit = 50) {
    const ref = db.collection('moderationQueue')
      .where('status', '==', 'pending_review')
      .orderBy('priorityScore', 'desc')
      .limit(limit);
    return ref.onSnapshot(snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(items);
    }, err => { console.warn('ModerationQueue subscription error', err?.message); callback([]); });
  }

  async getTop(limit = 20) {
    const snap = await db.collection('moderationQueue')
      .where('status', '==', 'pending_review')
      .orderBy('priorityScore', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async markUnderReview(_queueId, _actorId) {
    throw new Error('MODERATION_CLIENT_WRITE_DISABLED');
  }

  async resolve(_queueId, _resolution, _actorId) {
    throw new Error('MODERATION_CLIENT_WRITE_DISABLED');
  }
}

export default new ModerationQueueService();
