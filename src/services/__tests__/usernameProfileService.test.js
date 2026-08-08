jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../../config/firebase', () => ({
  firebaseNative: false,
  firestore: {},
}));

jest.mock('../ownProfileCache', () => ({
  hydrateOwnProfile: jest.fn(),
}));

import {
  hasValidPublicUsername,
  normalizeUsername,
  usernameKey,
  validateUsername,
} from '../usernameProfileService';

describe('usernameProfileService', () => {
  it('normalizes public handles and keys case-insensitively', () => {
    expect(normalizeUsername(' @Alex.Blyp ')).toBe('Alex.Blyp');
    expect(usernameKey(' @Alex.Blyp ')).toBe('alex.blyp');
  });

  it('accepts only supported username characters and lengths', () => {
    expect(validateUsername('alex_26').ok).toBe(true);
    expect(validateUsername('ab').ok).toBe(false);
    expect(validateUsername('alex-blyp').ok).toBe(false);
    expect(validateUsername('alex blyp').ok).toBe(false);
  });

  it('rejects Cognito UUIDs and the signed-in uid', () => {
    const uid = '110ec58a-a0f2-4ac4-8393-c866d813b8d1';
    expect(validateUsername(uid).ok).toBe(false);
    expect(validateUsername(uid, uid).ok).toBe(false);
    expect(hasValidPublicUsername({ username: uid }, uid)).toBe(false);
  });

  it('recognizes a valid username in either denormalized field', () => {
    expect(hasValidPublicUsername({ username: 'alex.26' })).toBe(true);
    expect(hasValidPublicUsername({ handle: 'alex_26' })).toBe(true);
  });
});
