import {
  BADGE_CATALOG,
  CLUB_CATALOG,
  MAX_PROFILE_BADGES_EQUIPPED,
  MAX_PROFILE_BADGES_FREE,
  MAX_PROFILE_CLUBS_FREE,
  MAX_PROFILE_CLUBS_PLUS,
  getProfileIdentityCaps,
  normalizeProfileBadges,
  normalizeProfileClubs,
  toggleIdInList,
} from '../profileIdentityCatalog';

describe('profileIdentityCatalog', () => {
  test('catalogs include football sample and Marble Racing', () => {
    expect(CLUB_CATALOG.some((c) => c.id === 'club_marble_racing')).toBe(true);
    expect(CLUB_CATALOG.filter((c) => c.kind === 'football').length).toBeGreaterThanOrEqual(6);
    expect(BADGE_CATALOG.length).toBeGreaterThanOrEqual(4);
  });

  test('normalize strips unknown ids and de-dupes', () => {
    expect(
      normalizeProfileClubs(['club_arsenal', 'nope', 'club_arsenal', 'club_marble_racing'])
    ).toEqual(['club_arsenal', 'club_marble_racing']);
    expect(normalizeProfileBadges(['badge_creator', 'x', 'badge_creator'])).toEqual([
      'badge_creator',
    ]);
  });

  test('normalize respects equip cap', () => {
    const many = BADGE_CATALOG.map((b) => b.id);
    expect(normalizeProfileBadges(many).length).toBe(MAX_PROFILE_BADGES_EQUIPPED);
  });

  test('getProfileIdentityCaps free vs plus', () => {
    expect(getProfileIdentityCaps(false)).toEqual({
      maxClubs: MAX_PROFILE_CLUBS_FREE,
      maxBadges: MAX_PROFILE_BADGES_FREE,
    });
    expect(getProfileIdentityCaps(true)).toEqual({
      maxClubs: MAX_PROFILE_CLUBS_PLUS,
      maxBadges: MAX_PROFILE_BADGES_EQUIPPED,
    });
  });

  test('normalize respects free caps', () => {
    const free = getProfileIdentityCaps(false);
    const clubs = CLUB_CATALOG.map((c) => c.id);
    const badges = BADGE_CATALOG.map((b) => b.id);
    expect(normalizeProfileClubs(clubs, free.maxClubs).length).toBe(MAX_PROFILE_CLUBS_FREE);
    expect(normalizeProfileBadges(badges, free.maxBadges).length).toBe(MAX_PROFILE_BADGES_FREE);
  });

  test('toggle respects max', () => {
    let list = [];
    list = toggleIdInList(list, 'a', 2);
    list = toggleIdInList(list, 'b', 2);
    list = toggleIdInList(list, 'c', 2);
    expect(list).toEqual(['a', 'b']);
    list = toggleIdInList(list, 'a', 2);
    expect(list).toEqual(['b']);
  });
});
