import {
  GRID9_ROULETTE_LAND_HOLD_MS,
  GRID9_ROULETTE_TICK_LATE_MS,
  GRID9_ROULETTE_TICK_START_MS,
  buildGrid9RouletteTicks,
  dramaticRouletteHighlightIndex,
  grid9RouletteTickAtElapsed,
} from '../grid9RouletteDrama';

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

describe('buildGrid9RouletteTicks', () => {
  it('starts near 2 Hz and slows toward 1 Hz before a 1.5s land hold', () => {
    const ticks = buildGrid9RouletteTicks({
      durationMs: 12_000,
      candidateCount: 4,
      selectedOffset: 2,
    });
    expect(ticks.length).toBeGreaterThan(8);
    const firstGap = ticks[1].atMs - ticks[0].atMs;
    expect(firstGap).toBeGreaterThanOrEqual(GRID9_ROULETTE_TICK_START_MS - 20);
    expect(firstGap).toBeLessThan(GRID9_ROULETTE_TICK_START_MS + 80);
    const lastSpin = ticks[ticks.length - 2];
    const land = ticks[ticks.length - 1];
    expect(land.landed).toBe(true);
    expect(land.candidateOffset).toBe(2);
    expect(land.atMs).toBe(12_000 - GRID9_ROULETTE_LAND_HOLD_MS);
    const lateGap = land.atMs - lastSpin.atMs;
    expect(lateGap).toBeGreaterThan(GRID9_ROULETTE_TICK_START_MS);
    expect(lateGap).toBeLessThanOrEqual(GRID9_ROULETTE_TICK_LATE_MS + 80);
    expect(grid9RouletteTickAtElapsed(12_000, ticks).landed).toBe(true);
  });
});
