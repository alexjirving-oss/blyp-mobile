import ReportingService from '../src/services/ReportingService';
import EnterpriseAnalyticsService from '../src/services/EnterpriseAnalyticsService';

// Minimal Firestore mock for reports collection
const firebaseConfig = require('../src/config/firebase');

const added = [];

const mockCollection = () => ({
  add: async (doc) => { const id = `r_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; added.push({ id, ...doc }); return { id }; },
  where: () => ({ get: async () => ({ docs: added.filter(d => d.status === 'open').map(d => ({ id: d.id, data: () => d })) }) })
});

firebaseConfig.db = { collection: () => mockCollection() };
firebaseConfig.auth.currentUser = { uid: 'u_test' };

describe('ReportingService', () => {
  test('reportStream creates open report', async () => {
    const res = await ReportingService.reportStream('stream123', 'spam', 'Spam content');
    expect(res.id).toBeTruthy();
    expect(res.status).toBe('open');
    expect(res.targetType).toBe('stream');
  });

  test('getOpenReports returns created reports', async () => {
    const reports = await ReportingService.getOpenReports();
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0].status).toBe('open');
  });
});
