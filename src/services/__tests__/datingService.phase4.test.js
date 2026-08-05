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

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DATING_GENDER_OPTIONS,
  DATING_PROMPT_OPTIONS,
  haversineKm,
  setDatingPrefs,
  getDatingPrefs,
  BIO_MAX,
  PROMPT_MAX,
} from '../datingService';

describe('datingService Phase 4', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('DATING_PROMPT_OPTIONS has at least 4 stems', () => {
    expect(DATING_PROMPT_OPTIONS.length).toBeGreaterThanOrEqual(4);
    DATING_PROMPT_OPTIONS.forEach((p) => {
      expect(typeof p.id).toBe('string');
      expect(typeof p.question).toBe('string');
      expect(p.question.length).toBeGreaterThan(0);
    });
  });

  test('gender options include woman, man, nonbinary, prefer_not', () => {
    const ids = DATING_GENDER_OPTIONS.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(['woman', 'man', 'nonbinary', 'prefer_not']));
  });

  test('haversineKm London to Paris is roughly 300–400 km', () => {
    const km = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(km).toBeGreaterThan(300);
    expect(km).toBeLessThan(400);
  });

  test('setDatingPrefs normalizes bio length, prompts, and lookingFor', async () => {
    const uid = 'test-user-phase4';
    const longBio = 'x'.repeat(BIO_MAX + 50);
    const next = await setDatingPrefs(uid, {
      bio: longBio,
      prompts: [
        { id: 'weekend', answer: 'Brunch and a long walk.' },
        { id: 'weekend', answer: 'duplicate should drop' },
        { id: 'bogus', answer: 'unknown id' },
        { id: 'laugh', answer: 'a'.repeat(200) },
        { id: 'looking', answer: 'Kindness.' },
        { id: 'green_flag', answer: 'Extra beyond max.' },
      ],
      lookingFor: ['woman', 'invalid', 'man', 'woman'],
    });

    expect(next.bio.length).toBe(BIO_MAX);
    expect(next.bio).toBe(longBio.slice(0, BIO_MAX));
    expect(next.prompts.length).toBeLessThanOrEqual(PROMPT_MAX);
    expect(next.prompts.every((p) => p.answer.length <= 120)).toBe(true);
    expect(next.prompts.map((p) => p.id)).toEqual(['weekend', 'laugh', 'looking']);
    expect(next.lookingFor).toEqual(['woman', 'man']);

    expect(AsyncStorage.setItem).toHaveBeenCalled();
    const stored = JSON.parse(AsyncStorage.setItem.mock.calls[0][1]);
    expect(stored.bio.length).toBe(BIO_MAX);
    expect(stored.lookingFor).toEqual(['woman', 'man']);

    const reloaded = await getDatingPrefs(uid);
    expect(reloaded.bio).toBe(next.bio);
    expect(reloaded.lookingFor).toEqual(['woman', 'man']);
  });
});
