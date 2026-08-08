import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_PAGES,
  PAGE_LAYOUT_VERSION,
  getEnabledPages,
  getFirstEnabledPageKey,
  migrateLegacyPageLayout,
  pagesWithInterestTopics,
  reconcilePages,
  setPages,
} from '../userPreferencesService';

describe('Home header page preferences', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  test('new layouts start Home, For You, then onboarding interests', () => {
    const pages = pagesWithInterestTopics(DEFAULT_PAGES, ['music', 'football']);

    expect(pages.slice(0, 4).map((page) => page.key)).toEqual([
      'home',
      'A',
      'topic:music',
      'topic:football',
    ]);
  });

  test('normalization preserves custom order and visibility', () => {
    const pages = reconcilePages([
      { key: 'topic:gaming', label: 'Gaming', enabled: true },
      { key: 'A', label: 'For You', enabled: false },
      { key: 'home', label: 'Home', fixed: true, enabled: false },
    ]);

    expect(pages.slice(0, 3).map((page) => page.key)).toEqual([
      'topic:gaming',
      'A',
      'home',
    ]);
    expect(pages.find((page) => page.key === 'A')?.enabled).toBe(false);
    expect(pages.find((page) => page.key === 'A')?.fixed).toBe(false);
    expect(pages.find((page) => page.key === 'home')?.enabled).toBe(true);
    expect(pages.find((page) => page.key === 'home')?.fixed).toBe(true);
  });

  test('legacy forced order migrates without losing topic visibility', () => {
    const migrated = migrateLegacyPageLayout([
      { key: 'A', label: 'For You', fixed: true, enabled: true },
      { key: 'home', label: 'Home', fixed: true, enabled: true },
      { key: 'following', label: 'Following', enabled: true },
      { key: 'B', label: "What's Hot", enabled: true },
      { key: 'C', label: 'Categories', enabled: true },
      { key: 'D', label: 'Hashtags', enabled: true },
      { key: 'topic:music', label: 'Music', enabled: false },
    ]);

    expect(migrated.slice(0, 3).map((page) => page.key)).toEqual([
      'home',
      'A',
      'topic:music',
    ]);
    expect(migrated.find((page) => page.key === 'topic:music')?.enabled).toBe(false);
  });

  test('first enabled page drives landing while Home remains available', () => {
    const prefs = {
      pages: [
        { key: 'A', label: 'For You', enabled: false },
        { key: 'topic:music', label: 'Music', enabled: true },
        { key: 'home', label: 'Home', fixed: true, enabled: true },
      ],
    };

    expect(getFirstEnabledPageKey(prefs)).toBe('topic:music');
    expect(getEnabledPages(prefs).map((page) => page.key)).toEqual(
      expect.arrayContaining(['topic:music', 'home'])
    );
  });

  test('setPages persists exact order and visibility to AsyncStorage', async () => {
    const uid = 'page-order-persistence';
    const saved = await setPages(uid, [
      { key: 'topic:gaming', label: 'Gaming', enabled: true },
      { key: 'home', label: 'Home', fixed: true, enabled: true },
      { key: 'A', label: 'For You', enabled: false },
    ]);
    const stored = JSON.parse(await AsyncStorage.getItem(`@blyp/prefs/${uid}`));

    expect(saved.pages.slice(0, 3).map((page) => page.key)).toEqual([
      'topic:gaming',
      'home',
      'A',
    ]);
    expect(stored.pages.slice(0, 3).map((page) => page.key)).toEqual([
      'topic:gaming',
      'home',
      'A',
    ]);
    expect(stored.pages.find((page) => page.key === 'A')?.enabled).toBe(false);
    expect(stored.pageLayoutVersion).toBe(PAGE_LAYOUT_VERSION);
  });
});
