import {
  BADGE_CATALOG,
  CLUB_CATALOG,
  MAX_PROFILE_BADGES_EQUIPPED,
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
