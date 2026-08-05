import {
  LIVE_LAYOUT_MODES,
  buildStickyGuestSlots,
  firstEmptyStickySlot,
  normalizeLiveLayoutMode,
  layoutUsesBottomTray,
  MAX_GUEST_SLOTS,
} from '../multiGuestLayout';

describe('multiGuestLayout sticky slots', () => {
  it('keeps empty placeholders when a middle slot is vacant', () => {
    const map = new Map<number, { id: string }>([
      [1, { id: 'a' }],
      [3, { id: 'c' }],
    ]);
    const slots = buildStickyGuestSlots(map, 4);
    expect(slots.map((s) => (s.occupant ? s.occupant.id : null))).toEqual([
      'a',
      null,
      'c',
      null,
    ]);
  });

  it('does not compact after a leave (slot 2 empty, slot 3 stays at 3)', () => {
    const afterLeave = new Map<number, string>([
      [1, 'alice'],
      [3, 'carol'],
    ]);
    const slots = buildStickyGuestSlots(afterLeave, 3);
    expect(slots[1].occupant).toBeNull();
    expect(slots[2].occupant).toBe('carol');
    expect(slots[2].slotId).toBe(3);
  });

  it('finds the first empty sticky slot without renumbering', () => {
    expect(firstEmptyStickySlot([1, 3], 4)).toBe(2);
    expect(firstEmptyStickySlot([1, 2, 3], 3)).toBeNull();
  });

  it('normalizes layout modes and tray usage', () => {
    expect(normalizeLiveLayoutMode('equal_grid')).toBe(LIVE_LAYOUT_MODES.EQUAL_GRID);
    expect(normalizeLiveLayoutMode('nope')).toBe(LIVE_LAYOUT_MODES.BOTTOM_GRID);
    expect(layoutUsesBottomTray(LIVE_LAYOUT_MODES.BOTTOM_GRID)).toBe(true);
    expect(layoutUsesBottomTray(LIVE_LAYOUT_MODES.EQUAL_GRID)).toBe(false);
    expect(MAX_GUEST_SLOTS).toBe(11);
  });
});
