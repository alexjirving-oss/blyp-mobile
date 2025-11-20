// ModerationQueueService: client-side accessors for aggregated moderation queue (admins/moderators)
// Domain: Trust & Safety. Non-invasive read layer over moderationQueue collection.

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

  async markUnderReview(queueId, actorId) {
    const update = { status: 'under_review' };
    if (actorId) update.actorId = actorId;
    await db.collection('moderationQueue').doc(queueId).update(update);
    try {
      const EnterpriseAnalyticsService = (await import('./EnterpriseAnalyticsService')).default;
      EnterpriseAnalyticsService.addEvent({ type: 'moderation_action', action: 'under_review', queueId, actorId: actorId || null, timestamp: Date.now() });
    } catch {}
  }

  async resolve(queueId, resolution, actorId) {
    // resolution expected shape: { actionType, ruleId?, notes? }
    const resolutionRecord = { ...resolution, actorId: actorId || null, resolvedAt: Date.now() };
    await db.collection('moderationQueue').doc(queueId).update({ status: 'resolved', resolution: resolutionRecord, resolvedAt: resolutionRecord.resolvedAt });
    try {
      const EnterpriseAnalyticsService = (await import('./EnterpriseAnalyticsService')).default;
      EnterpriseAnalyticsService.addEvent({ type: 'moderation_action', action: 'resolved', queueId, actorId: actorId || null, resolution: resolutionRecord, timestamp: Date.now() });
    } catch {}
  }
}

export default new ModerationQueueService();
