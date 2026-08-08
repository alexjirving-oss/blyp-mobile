import {
  resolveTeamIdentity,
  resolveTeamName,
  teamNameNeedsResolution,
} from '../../utils/teamIdentity';

describe('team public identities', () => {
  const uid = '9078d605-5dc7-450e-a063-e4a8054deb97';

  it('prefers a public display name and keeps the username separately', () => {
    expect(
      resolveTeamIdentity(
        [
          { displayName: 'Alex J Irving', username: 'AlexJIrving' },
          { displayName: uid },
        ],
        uid
      )
    ).toEqual({
      displayName: 'Alex J Irving',
      username: 'AlexJIrving',
      label: 'Alex J Irving',
    });
  });

  it('rejects private-looking email labels and falls back to a public username', () => {
    expect(
      resolveTeamIdentity(
        [{ displayName: 'person@example.com', username: 'melody.skull.queen' }],
        uid
      ).displayName
    ).toBe('melody.skull.queen');
  });

  it('replaces generated UUID and opaque-id team names', () => {
    expect(teamNameNeedsResolution(`${uid}'s Team`, uid)).toBe(true);
    expect(teamNameNeedsResolution("blyp_1786052182010_bkv4yoeod's Team")).toBe(true);
    expect(resolveTeamName(`${uid}'s Team`, 'Melody', uid)).toBe("Melody's Team");
  });

  it('preserves a custom team name', () => {
    expect(teamNameNeedsResolution('Northern Lights', uid)).toBe(false);
    expect(resolveTeamName('Northern Lights', 'Alex J Irving', uid)).toBe('Northern Lights');
  });
});
