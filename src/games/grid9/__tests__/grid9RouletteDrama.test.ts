import { dramaticRouletteHighlightIndex } from '../grid9RouletteDrama';

describe('dramaticRouletteHighlightIndex', () => {
  it('lands on selected offset at t=1', () => {
    expect(dramaticRouletteHighlightIndex(1, 5, 3)).toBe(3);
    expect(dramaticRouletteHighlightIndex(0.999, 5, 2)).toBe(2);
  });

  it('moves across candidates before landing', () => {
    const seen = new Set<number>();
    for (let i = 0; i <= 20; i += 1) {
      seen.add(dramaticRouletteHighlightIndex(i / 20, 4, 1));
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(dramaticRouletteHighlightIndex(1, 4, 1)).toBe(1);
  });
});
