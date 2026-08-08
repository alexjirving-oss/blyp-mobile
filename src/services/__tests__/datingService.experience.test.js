jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../config/firebase', () => ({
  db: { collection: jest.fn() },
  auth: null,
  firebaseEnabled: true,
}));

jest.mock('../BlockService', () => ({
  loadBlockedUsers: jest.fn(() => Promise.resolve()),
  getBlockedSet: jest.fn(() => new Set(['blocked-user'])),
}));

import { db } from '../../config/firebase';
import { fetchIncomingLikes } from '../datingService';

const snapshot = (data) => ({
  exists: () => !!data,
  data: () => data,
});

const queryResult = (docs) => ({
  limit: () => ({
    get: async () => ({ docs }),
  }),
});

describe('dating experience data', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const prefs = {
      viewer: {
        adultConfirmed: true,
        optedIn: true,
        birthYear: 1990,
        geoLat: 0,
        geoLon: 0,
        updatedAt: 10,
      },
      'pending-user': {
        adultConfirmed: true,
        optedIn: true,
        birthYear: 1992,
        bio: 'Walks, films, and ambitious cooking.',
        geoLat: 0,
        geoLon: 1,
        updatedAt: 11,
      },
      'handled-user': {
        adultConfirmed: true,
        optedIn: true,
        birthYear: 1991,
        updatedAt: 11,
      },
      'passed-user': {
        adultConfirmed: true,
        optedIn: true,
        birthYear: 1989,
        updatedAt: 11,
      },
      'blocked-user': {
        adultConfirmed: true,
        optedIn: true,
        birthYear: 1993,
        updatedAt: 11,
      },
    };

    const users = {
      'pending-user': {
        displayName: 'Morgan',
        username: 'morgan',
        photoURL: 'https://example.com/morgan.jpg',
      },
      'handled-user': { displayName: 'Handled' },
      'passed-user': { displayName: 'Passed' },
      'blocked-user': { displayName: 'Blocked' },
    };

    const incoming = [
      ['pending-like', 'pending-user', 400],
      ['handled-like', 'handled-user', 300],
      ['passed-like', 'passed-user', 200],
      ['blocked-like', 'blocked-user', 100],
    ].map(([id, fromUid, createdAt]) => ({
      id,
      data: () => ({ fromUid, toUid: 'viewer', createdAt }),
    }));

    db.collection.mockImplementation((name) => {
      if (name === 'datingLikes') {
        return {
          where: (field) =>
            field === 'toUid'
              ? queryResult(incoming)
              : queryResult([
                  {
                    id: 'viewer-handled-like',
                    data: () => ({ fromUid: 'viewer', toUid: 'handled-user' }),
                  },
                ]),
        };
      }
      if (name === 'datingPasses') {
        return {
          where: () =>
            queryResult([
              {
                id: 'viewer-pass',
                data: () => ({ fromUid: 'viewer', toUid: 'passed-user' }),
              },
            ]),
        };
      }
      if (name === 'datingPrefs') {
        return {
          doc: (id) => ({ get: async () => snapshot(prefs[id]) }),
        };
      }
      if (name === 'users') {
        return {
          doc: (id) => ({ get: async () => snapshot(users[id]) }),
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    });
  });

  test('returns only pending incoming likes with profile context', async () => {
    const likes = await fetchIncomingLikes('viewer');

    expect(likes).toHaveLength(1);
    expect(likes[0]).toEqual(
      expect.objectContaining({
        id: 'pending-user',
        otherUserId: 'pending-user',
        likeId: 'pending-like',
        displayName: 'Morgan',
        distanceKm: 111,
      }),
    );
  });
});
