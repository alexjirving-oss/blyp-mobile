jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../config/firebase', () => ({
  db: null,
  auth: null,
  firebaseEnabled: false,
}));

import {
  canParticipateInDiscover,
  confirmAdult,
  getDatingPrefs,
  setDatingOptIn,
  setDatingPrefs,
} from '../datingService';

describe('datingService Phase 5 soft age gate', () => {
  const uid = 'test-user-phase5';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('canParticipateInDiscover requires adult + optedIn + birthYear', async () => {
    expect(canParticipateInDiscover(null)).toBe(false);
    expect(canParticipateInDiscover({ adultConfirmed: true, optedIn: true, birthYear: null })).toBe(false);
    expect(canParticipateInDiscover({ adultConfirmed: true, optedIn: true, birthYear: 2015 })).toBe(false);
    expect(canParticipateInDiscover({ adultConfirmed: true, optedIn: true, birthYear: 1990 })).toBe(true);
  });

  test('setDatingOptIn refuses without birth year', async () => {
    await setDatingPrefs(uid, { birthYear: null, optedIn: false });
    await confirmAdult(uid);
    await expect(setDatingOptIn(uid, true)).rejects.toThrow(/birth year/i);
    const prefs = await getDatingPrefs(uid);
    expect(prefs.optedIn).toBe(false);
  });

  test('setDatingOptIn succeeds with birth year after adult confirm', async () => {
    await setDatingPrefs(uid, { birthYear: 1992, optedIn: false });
    await confirmAdult(uid);
    const next = await setDatingOptIn(uid, true);
    expect(next.optedIn).toBe(true);
    expect(canParticipateInDiscover(next)).toBe(true);
  });
});
