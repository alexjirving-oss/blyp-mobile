// ReportingService: handles user/content/stream reports and open report queries
// Uses Firestore collections: reports, moderationQueue (future aggregation)
// Only minimal logic; aggregation to moderationQueue handled later via Cloud Function.

import { db, auth } from '../config/firebase';
import EnterpriseAnalyticsService from './EnterpriseAnalyticsService';

class ReportingService {
  async reportContent({ targetType, targetId, reasonCode, details, surface }) {
    const user = auth.currentUser;
    if (!user) throw new Error('Must be authenticated to file report');
    if (!targetType || !targetId || !reasonCode) throw new Error('Missing required report fields');
    const doc = {
      targetType,
      targetId,
      reporterId: user.uid,
      reasonCode,
      details: (details || '').slice(0, 500),
      createdAt: Date.now(), // client timestamp (serverTimestamp used in index function later)
      status: 'open'
    };
    if (typeof surface === 'string' && surface.trim()) {
      doc.surface = surface.trim().slice(0, 40);
    }
    const ref = await db.collection('reports').add(doc);
    try {
      EnterpriseAnalyticsService.trackError('report_stream', { // reuse trackError for visibility until specific event added
        type: 'report_filed',
        message: 'User filed report',
        code: 'REPORT_FILED',
        severity: 'low',
        context: { targetType, targetId, reasonCode, surface: doc.surface || null }
      });
    } catch {}
    return { id: ref.id, ...doc };
  }

  async reportUser(userId, reasonCode, details) {
    return this.reportContent({ targetType: 'user', targetId: userId, reasonCode, details });
  }

  async reportStream(streamId, reasonCode, details) {
    return this.reportContent({ targetType: 'stream', targetId: streamId, reasonCode, details });
  }

  async getOpenReports(limit = 50) {
    const snap = await db.collection('reports').where('status', '==', 'open').get();
    const out = [];
    snap.docs.forEach(d => out.push({ id: d.id, ...d.data() }));
    return out.slice(0, limit);
  }

  subscribeToOpenReports(callback) {
    const q = db.collection('reports').where('status', '==', 'open');
    return q.onSnapshot(snap => {
      const out = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(out);
    }, err => { console.warn('Reporting subscription error', err?.message); callback([]); });
  }
}

export default new ReportingService();
