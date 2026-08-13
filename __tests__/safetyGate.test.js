/**
 * @jest-environment node
 */
jest.mock('../src/config/firebase', () => ({
  db: null,
  auth: { currentUser: null },
  firebaseEnabled: false,
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      getItem: async (k) => (store.has(k) ? store.get(k) : null),
      setItem: async (k, v) => {
        store.set(k, String(v));
      },
      removeItem: async (k) => {
        store.delete(k);
      },
      clear: async () => store.clear(),
    },
  };
});

const {
  evaluateSafetyGate,
  acceptSafetyPolicies,
  declareAge,
  MIN_BROADCAST_AGE,
  SAFETY_POLICY_BUNDLE_VERSION,
} = require('../src/services/safety/SafetyGateService');

const { inspectLiveChat } = require('../src/services/safety/LiveChatNlp');
const {
  resolveScannerProvider,
  shouldAutoKill,
  scanLiveSample,
} = require('../src/services/safety/LiveSafetyScanner');

describe('SafetyGateService', () => {
  const uid = 'test-user-safety-gate';

  beforeEach(async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    await AsyncStorage.clear();
  });

  it('requires terms + age for a fresh user', async () => {
    const ev = await evaluateSafetyGate(uid);
    expect(ev.ok).toBe(false);
    expect(ev.needsTerms).toBe(true);
    expect(ev.needsAge).toBe(true);
  });

  it('accepts policies and age for 18+', async () => {
    await acceptSafetyPolicies(uid, { acceptedTerms: true, acceptedGuidelines: true });
    const year = new Date().getFullYear() - MIN_BROADCAST_AGE - 2;
    const age = await declareAge(uid, { birthYear: year });
    expect(age.underage).toBe(false);
    const ev = await evaluateSafetyGate(uid);
    expect(ev.ok).toBe(true);
    expect(ev.acceptedBundleVersion).toBe(SAFETY_POLICY_BUNDLE_VERSION);
  });

  it('blocks underage broadcast', async () => {
    await acceptSafetyPolicies(uid, { acceptedTerms: true, acceptedGuidelines: true });
    const year = new Date().getFullYear() - 15;
    const age = await declareAge(uid, { birthYear: year });
    expect(age.underage).toBe(true);
    const ev = await evaluateSafetyGate(uid);
    expect(ev.ok).toBe(false);
    expect(ev.underage).toBe(true);
  });
});

describe('LiveChatNlp', () => {
  it('flags toxicity extras', () => {
    const r = inspectLiveChat('you should kys now');
    expect(r.blocked).toBe(true);
    expect(r.flagged).toBe(true);
  });

  it('allows clean chat', () => {
    const r = inspectLiveChat('great stream!');
    expect(r.blocked).toBe(false);
    expect(r.clean).toContain('great');
  });
});

describe('LiveSafetyScanner', () => {
  it('defaults to none provider and does not auto-kill stub', async () => {
    expect(resolveScannerProvider()).toBe('none');
    const result = await scanLiveSample({ streamId: 's1', hint: 'periodic_stub' });
    expect(result.providerNeeded).toBe(true);
    expect(result.severity).toBe('pending_review');
    expect(shouldAutoKill(result)).toBe(false);
  });
});
