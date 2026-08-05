import {
  resolveClubIdFromQuery,
  searchClubs,
  userMatchesClubQuery,
} from '../clubDiscoveryService';
import { CLUB_CATALOG } from '../profileIdentityCatalog';

describe('clubDiscoveryService', () => {
  test('searchClubs matches Arsenal and Marble Racing', () => {
    expect(searchClubs('arsenal').some((c) => c.id === 'club_arsenal')).toBe(true);
    expect(searchClubs('marble').some((c) => c.id === 'club_marble_racing')).toBe(true);
    expect(searchClubs('spurs')[0]?.id).toBe('club_tottenham');
  });

  test('resolveClubIdFromQuery returns catalog id', () => {
    expect(resolveClubIdFromQuery('Chelsea')).toBe('club_chelsea');
    expect(resolveClubIdFromQuery('zzz-unknown')).toBe(null);
  });

  test('userMatchesClubQuery uses profileClubs + labels', () => {
    const user = { profileClubs: ['club_arsenal', 'club_marble_racing'] };
    expect(userMatchesClubQuery(user, 'arsenal')).toBe(true);
    expect(userMatchesClubQuery(user, 'Marble')).toBe(true);
    expect(userMatchesClubQuery(user, 'liverpool')).toBe(false);
    expect(userMatchesClubQuery({ profileClubs: [] }, 'arsenal')).toBe(false);
  });

  test('catalog still includes football + marble for discovery', () => {
    expect(CLUB_CATALOG.some((c) => c.id === 'club_marble_racing')).toBe(true);
    expect(CLUB_CATALOG.filter((c) => c.kind === 'football').length).toBeGreaterThanOrEqual(6);
  });
});
