import {
  BADGE_CATALOG,
  CLUB_CATALOG,
  MAX_PROFILE_BADGES_EQUIPPED,
  MAX_PROFILE_BADGES_FREE,
  MAX_PROFILE_CLUBS_FREE,
  MAX_PROFILE_CLUBS_PLUS,
  SPORTSDB_PREMIER_LEAGUE_ID,
  clubToSportsDbTeam,
  getProfileIdentityCaps,
  isServerEarnedBadge,
  normalizeEarnedBadgeIds,
  normalizeEquippableBadges,
  normalizeProfileBadges,
  normalizeProfileClubs,
  resolveSportsDbTeamsFromClubs,
  toggleIdInList,
} from '../profileIdentityCatalog';

describe('profileIdentityCatalog', () => {
  test('catalogs include football sample and Marble Racing', () => {
    expect(CLUB_CATALOG.some((c) => c.id === 'club_marble_racing')).toBe(true);
    expect(CLUB_CATALOG.filter((c) => c.kind === 'football').length).toBeGreaterThanOrEqual(6);
    expect(BADGE_CATALOG.length).toBeGreaterThanOrEqual(4);
  });

  test('server-earn badges include live host, marble podium, early', () => {
    expect(isServerEarnedBadge('badge_live_host')).toBe(true);
    expect(isServerEarnedBadge('badge_marble_podium')).toBe(true);
    expect(isServerEarnedBadge('badge_early_blyper')).toBe(true);
    expect(isServerEarnedBadge('badge_creator')).toBe(false);
    expect(BADGE_CATALOG.filter((b) => b.earn === 'server').map((b) => b.id)).toEqual(
      expect.arrayContaining([
        'badge_live_host',
        'badge_marble_podium',
        'badge_early_blyper',
      ])
    );
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

  test('equippable badges strip unearned server ids', () => {
    expect(
      normalizeEquippableBadges(
        ['badge_live_host', 'badge_creator', 'badge_marble_podium'],
        [],
        3
      )
    ).toEqual(['badge_creator']);
    expect(
      normalizeEquippableBadges(
        ['badge_live_host', 'badge_creator', 'badge_marble_podium'],
        ['badge_live_host', 'badge_marble_podium'],
        3
      )
    ).toEqual(['badge_live_host', 'badge_creator', 'badge_marble_podium']);
  });

  test('normalizeEarnedBadgeIds keeps server ids only', () => {
    expect(
      normalizeEarnedBadgeIds(['badge_live_host', 'badge_creator', 'nope'])
    ).toEqual(['badge_live_host']);
  });

  test('football clubs map to SportsDB team ids', () => {
    expect(clubToSportsDbTeam('club_arsenal')).toEqual(
      expect.objectContaining({
        id: '133604',
        name: 'Arsenal',
        leagueId: SPORTSDB_PREMIER_LEAGUE_ID,
        sport: 'Soccer',
      })
    );
    expect(clubToSportsDbTeam('club_marble_racing')).toBeNull();
    const mapped = resolveSportsDbTeamsFromClubs([
      'club_arsenal',
      'club_tottenham',
      'club_marble_racing',
      'club_arsenal',
    ]);
    expect(mapped.map((t) => t.id)).toEqual(['133604', '133616']);
  });
});
