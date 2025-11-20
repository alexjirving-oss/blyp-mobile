import AuthConsistencyService from '../src/services/AuthConsistencyService';
import EnterpriseAnalyticsService from '../src/services/EnterpriseAnalyticsService';

// Basic test to ensure status categorization logic works when both identities absent.

describe('AuthConsistencyService', () => {
  test('snapshotParity returns none when no users present', async () => {
    // Force firebase currentUser to null (simulate logout)
    const original = Object.getOwnPropertyDescriptor(require('../src/config/firebase').auth, 'currentUser');
    Object.defineProperty(require('../src/config/firebase').auth, 'currentUser', { value: null, configurable: true });

    const parity = await AuthConsistencyService.snapshotParity();
    expect(parity.status).toBe('none');

    // Restore descriptor if existed
    if (original) {
      Object.defineProperty(require('../src/config/firebase').auth, 'currentUser', original);
    }
  });
});
