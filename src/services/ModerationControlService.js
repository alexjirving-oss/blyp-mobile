// ModerationControlService: live moderation actions + logging
// Stores actions in moderationActions collection; live controls in liveStreams/{id}/controls doc.

import { db, auth } from '../config/firebase';

class ModerationControlService {
  async _logAction({ actionType, targetType, targetId, streamId, reasonCode, ruleId, expiresAt }) {
    const user = auth.currentUser;
    const actorId = user?.uid || 'system';
    const doc = {
      actorId,
      actionType,
      targetType,
      targetId,
      streamId: streamId || null,
      reasonCode: reasonCode || 'unspecified',
      ruleId: ruleId || null,
      createdAt: Date.now(),
      expiresAt: expiresAt || null
    };
    try { await db.collection('moderationActions').add(doc); } catch (e) { console.warn('Moderation action log failed', e?.message); }
  }

  async muteUser(streamId, userId, durationMs = 300000, reasonCode) {
    const ref = db.collection('liveStreams').doc(streamId).collection('controls').doc('mutes');
    const muteUntil = Date.now() + durationMs;
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    data[userId] = muteUntil;
    await ref.set(data, { merge: true });
    await this._logAction({ actionType: 'mute', targetType: 'user', targetId: userId, streamId, reasonCode, expiresAt: muteUntil });
    return { userId, muteUntil };
  }

  async kickUser(streamId, userId, reasonCode) {
    const ref = db.collection('liveStreams').doc(streamId).collection('controls').doc('kicks');
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    data[userId] = Date.now();
    await ref.set(data, { merge: true });
    await this._logAction({ actionType: 'kick', targetType: 'user', targetId: userId, streamId, reasonCode });
    return { userId };
  }

  async setSlowMode(streamId, intervalMs, reasonCode) {
    const ref = db.collection('liveStreams').doc(streamId).collection('controls').doc('slowMode');
    await ref.set({ intervalMs, updatedAt: Date.now() }, { merge: true });
    await this._logAction({ actionType: 'slow_mode', targetType: 'stream', targetId: streamId, streamId, reasonCode });
    return { streamId, intervalMs };
  }

  async isUserMuted(streamId, userId) {
    const ref = db.collection('liveStreams').doc(streamId).collection('controls').doc('mutes');
    const snap = await ref.get();
    if (!snap.exists) return false;
    const data = snap.data() || {};
    const until = data[userId];
    return !!until && Date.now() < until;
  }

  async getSlowMode(streamId) {
    const ref = db.collection('liveStreams').doc(streamId).collection('controls').doc('slowMode');
    const snap = await ref.get();
    return snap.exists ? snap.data().intervalMs : 0;
  }
}

export default new ModerationControlService();
