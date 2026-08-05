import {
  normalizeSportTags,
  normalizeTeamIds,
  resolvePublishSportTags,
  sportTagForTeam,
} from '../sportPostTags';

describe('sportPostTags', () => {
  test('normalizeSportTags keeps known interest ids', () => {
    expect(normalizeSportTags(['football', 'NOPE', 'f1', 'football'])).toEqual(['football', 'f1']);
  });

  test('sportTagForTeam maps Soccer and F1', () => {
    expect(sportTagForTeam({ sport: 'Soccer' })).toBe('football');
    expect(sportTagForTeam({ sport: 'F1' })).toBe('f1');
    expect(sportTagForTeam({ sport: 'Hockey' })).toBeNull();
  });

  test('resolvePublishSportTags auto-attaches followed teams', () => {
    const followed = [
      { id: '133604', name: 'Arsenal', sport: 'Soccer' },
      { id: 'mercedes', name: 'Mercedes', sport: 'F1' },
    ];
    const out = resolvePublishSportTags({ followedTeams: followed });
    expect(out.sportTags).toEqual(expect.arrayContaining(['football', 'f1']));
    expect(out.teamIds).toEqual(expect.arrayContaining(['133604', 'mercedes']));
  });

  test('explicit picks win for teamIds', () => {
    const out = resolvePublishSportTags({
      followedTeams: [{ id: '133604', sport: 'Soccer' }],
      selectedSportTags: ['football'],
      selectedTeamIds: ['133610'],
    });
    expect(out.sportTags).toEqual(['football']);
    expect(out.teamIds).toEqual(['133610']);
  });

  test('normalizeTeamIds de-dupes', () => {
    expect(normalizeTeamIds(['a', 'a', '', 'b'])).toEqual(['a', 'b']);
  });
});
