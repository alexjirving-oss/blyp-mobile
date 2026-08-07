import { looksLikeRawId, pickPublicLabel } from '../../utils/publicLabel';

describe('public live labels', () => {
  const uid = '96b24294-6051-70bb-3f4c-a40185e033cf';

  it('prefers a public username over an opaque display name', () => {
    expect(pickPublicLabel(
      { username: '@alex.blyp', displayName: uid },
      { uid, fallback: 'Guest' },
    )).toBe('alex.blyp');
    expect(pickPublicLabel(
      { username: 'User', displayName: 'Alex Blyp' },
      { uid, fallback: 'Guest' },
    )).toBe('Alex Blyp');
  });

  it('never returns a Cognito sub or user_ token', () => {
    expect(looksLikeRawId(uid)).toBe(true);
    expect(pickPublicLabel({ username: uid }, { uid, fallback: 'Viewer' })).toBe('Viewer');
    expect(pickPublicLabel({ username: 'user_01ABCDEF23456789' }, { fallback: 'Guest' })).toBe('Guest');
    expect(pickPublicLabel({ displayName: 'A1bcDefGhijkLmnoPqrstUvwxYz1' }, { fallback: 'Guest' })).toBe('Guest');
  });

  it('uses a neutral fallback only when no public label exists', () => {
    expect(pickPublicLabel({}, { uid, fallback: 'Guest' })).toBe('Guest');
  });
});
