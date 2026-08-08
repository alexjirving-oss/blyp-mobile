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

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearPendingProfile,
  clearUsernameDeferred,
  hasValidPublicUsername,
  isUsernameDeferred,
  markUsernameDeferred,
  normalizeUsername,
  readPendingProfile,
  readPendingProfileForUser,
  rememberPendingProfile,
  usernameKey,
  validateUsername,
} from '../usernameProfileService';

describe('usernameProfileService', () => {
  beforeEach(() => {
    AsyncStorage.getItem.mockReset();
    AsyncStorage.setItem.mockReset();
    AsyncStorage.removeItem.mockReset();
    AsyncStorage.getItem.mockResolvedValue(null);
    AsyncStorage.setItem.mockResolvedValue(undefined);
    AsyncStorage.removeItem.mockResolvedValue(undefined);
  });

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

  it('persists pending signup profile with email for shared-device safety', async () => {
    await rememberPendingProfile({
      source: 'signup',
      username: 'Alex.Blyp',
      email: 'Alex@Example.com',
    });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@blyp/auth/pending-profile-v1',
      expect.stringContaining('"email":"alex@example.com"'),
    );
    const stored = JSON.parse(AsyncStorage.setItem.mock.calls[0][1]);
    expect(stored.username).toBe('Alex.Blyp');
    expect(stored.source).toBe('signup');
  });

  it('ignores pending profile when email does not match signed-in user', async () => {
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify({
      source: 'signup',
      username: 'Alex.Blyp',
      email: 'other@example.com',
      createdAt: Date.now(),
    }));
    const pending = await readPendingProfileForUser({ email: 'alex@example.com' });
    expect(pending).toBeNull();
  });

  it('returns pending profile when email matches', async () => {
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify({
      source: 'signup',
      username: 'Alex.Blyp',
      email: 'alex@example.com',
      createdAt: Date.now(),
    }));
    const pending = await readPendingProfileForUser({ email: 'alex@example.com' });
    expect(pending?.username).toBe('Alex.Blyp');
  });

  it('persists username deferral so the overlay does not return every launch', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);
    expect(await isUsernameDeferred('uid-1')).toBe(false);
    await markUsernameDeferred('uid-1');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@blyp/auth/username-deferred-v1:uid-1',
      expect.any(String),
    );
    AsyncStorage.getItem.mockResolvedValue('{"deferredAt":1}');
    expect(await isUsernameDeferred('uid-1')).toBe(true);
    await clearUsernameDeferred('uid-1');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      '@blyp/auth/username-deferred-v1:uid-1',
    );
  });

  it('clears pending profile storage', async () => {
    await clearPendingProfile();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@blyp/auth/pending-profile-v1');
  });

  it('expires stale pending profiles', async () => {
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify({
      source: 'signup',
      username: 'olduser',
      email: 'alex@example.com',
      createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    }));
    const pending = await readPendingProfile();
    expect(pending).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@blyp/auth/pending-profile-v1');
  });
});
