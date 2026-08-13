const { buildLadderKey, ladderFromKey } = require('../src/feed/forYouLadder');

describe('ForYouVideo ladder stability', () => {
  it('same URI content yields same ladderKey across fresh fallback arrays', () => {
    const a = buildLadderKey('https://cdn/x.mp4', ['https://cdn/y.mp4']);
    const b = buildLadderKey('https://cdn/x.mp4', ['https://cdn/y.mp4']);
    expect(a).toBe(b);
    expect(ladderFromKey(a)).toEqual(['https://cdn/x.mp4', 'https://cdn/y.mp4']);
  });

  it('changes when primary URI changes', () => {
    const a = buildLadderKey('https://cdn/a.mp4', []);
    const b = buildLadderKey('https://cdn/b.mp4', []);
    expect(a).not.toBe(b);
  });
});
