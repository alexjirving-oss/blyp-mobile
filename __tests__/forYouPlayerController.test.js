const {
  roleForIndex,
  shouldLoadCell,
  playbackFlags,
  FOR_YOU_WARM_RADIUS,
} = require('../src/feed/ForYouEngine');
const {
  planForYouWindow,
  promoteActive,
} = require('../src/feed/forYouPlayerController');

describe('ForYouEngine roles', () => {
  it('marks active ±1 as neighbor within warm radius', () => {
    expect(roleForIndex(5, 5)).toBe('active');
    expect(roleForIndex(4, 5)).toBe('neighbor');
    expect(roleForIndex(6, 5)).toBe('neighbor');
    expect(roleForIndex(3, 5)).toBe('none');
    expect(FOR_YOU_WARM_RADIUS).toBe(1);
  });

  it('loads only warm window', () => {
    expect(shouldLoadCell(5, 5, 5)).toBe(true);
    expect(shouldLoadCell(6, 5, 5)).toBe(true);
    expect(shouldLoadCell(8, 5, 5)).toBe(false);
  });

  it('neighbors stay paused+muted; active plays unmuted unless feed muted', () => {
    const n = playbackFlags({
      index: 4,
      activeIndex: 5,
      cellActive: false,
    });
    expect(n).toEqual({ shouldPlay: false, isMuted: true, role: 'neighbor' });

    const a = playbackFlags({
      index: 5,
      activeIndex: 5,
      cellActive: true,
      feedMuted: false,
    });
    expect(a.shouldPlay).toBe(true);
    expect(a.isMuted).toBe(false);
    expect(a.role).toBe('active');
  });
});

describe('forYouPlayerController', () => {
  it('plans ≤1 active and ≤2 warm slots', () => {
    const plan = planForYouWindow({ activeIndex: 2, itemCount: 6 });
    const actives = plan.slots.filter((s) => s.role === 'active');
    const warm = plan.slots.filter((s) => s.role === 'neighbor');
    expect(actives).toHaveLength(1);
    expect(warm.length).toBeLessThanOrEqual(2);
    expect(plan.warmIndexes).toEqual([1, 3]);
  });

  it('seekToZero on promote to a new active index', () => {
    const first = planForYouWindow({ activeIndex: 0, itemCount: 4 });
    const next = promoteActive(first, 1, { itemCount: 4 });
    const active = next.slots.find((s) => s.role === 'active');
    expect(active.index).toBe(1);
    expect(active.seekToZero).toBe(true);
    expect(active.shouldPlay).toBe(true);
  });

  it('does not mark seekToZero when active index unchanged', () => {
    const first = planForYouWindow({
      activeIndex: 1,
      itemCount: 4,
      previousActiveIndex: 1,
    });
    const active = first.slots.find((s) => s.role === 'active');
    expect(active.seekToZero).toBe(false);
  });
});
