// AuthConsistencyService: Verifies parity between Cognito and Firebase identities and emits analytics events.
// Domain: Auth, Observability. Non-breaking, additive instrumentation per MegaCommand section 18 & 10.

import { auth } from '../config/firebase';
import EnterpriseAnalyticsService from './EnterpriseAnalyticsService';

let AmplifyAuth = null; // lazy import to avoid startup weight
try {
  // aws-amplify Auth import (guarded for environments lacking module)
  const mod = require('aws-amplify');
  AmplifyAuth = mod.Auth || mod.default?.Auth || null;
} catch (e) {
  AmplifyAuth = null;
}

class AuthConsistencyService {
  constructor() {
    this._interval = null;
    this._defaultIntervalMs = 120000; // 2 min
  }

  async snapshotParity() {
    const firebaseUser = auth.currentUser || null;
    let cognitoUser = null;
    try {
      if (AmplifyAuth) {
        cognitoUser = await AmplifyAuth.currentAuthenticatedUser({ bypassCache: true });
      }
    } catch (e) {
      // Not signed in or error; treat as null
      cognitoUser = null;
    }

    const firebaseUid = firebaseUser?.uid || null;
    const cognitoUsername = cognitoUser?.username || null;
    const cognitoSub = cognitoUser?.attributes?.sub || null;

    const bothPresent = !!firebaseUid && !!cognitoUsername;
    const status = bothPresent
      ? 'both_present'
      : firebaseUid && !cognitoUsername
        ? 'firebase_only'
        : !firebaseUid && cognitoUsername
          ? 'cognito_only'
          : 'none';

    const parity = {
      status,
      firebaseUid,
      cognitoUsername,
      cognitoSub,
      timestamp: Date.now()
    };

    // Emit analytics event (batch-friendly)
    EnterpriseAnalyticsService.addEvent({
      type: 'auth_consistency',
      ...parity
    });

    return parity;
  }

  startPeriodicChecks(intervalMs = this._defaultIntervalMs) {
    if (this._interval) return; // already running
    this._interval = setInterval(() => {
      this.snapshotParity().catch(err => {
        EnterpriseAnalyticsService.addEvent({
          type: 'auth_consistency_error',
          message: err?.message,
          timestamp: Date.now()
        });
      });
    }, intervalMs);
  }

  stopPeriodicChecks() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}

export default new AuthConsistencyService();
