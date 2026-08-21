import {
  LIVE_LAYOUT_MODES,
  DEFAULT_LIVE_LAYOUT_MODE,
  buildStickyGuestSlots,
  buildVisibleGuestSlotIds,
  firstEmptyStickySlot,
  guestTileWidthPercent,
  guestsPerTrayPage,
  normalizeLiveLayoutMode,
  mapStudioLayoutToLiveLayoutMode,
  resolveLiveLayoutMode,
  layoutUsesBottomTray,
  guestBoxesForLayout,
  measureHostTop9WatchLayout,
  pickHostWatchStream,
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

  it('gives the first guest box 1 when the panel is empty (host is not a guest box)', () => {
    expect(firstEmptyStickySlot([], MAX_GUEST_SLOTS)).toBe(1);
    // Slot 0 (host primary) must never appear in the occupied guest set.
    expect(firstEmptyStickySlot([0], MAX_GUEST_SLOTS)).toBe(1);
  });

  it('normalizes layout modes and tray usage', () => {
    expect(normalizeLiveLayoutMode('equal_grid')).toBe(LIVE_LAYOUT_MODES.EQUAL_GRID);
    expect(normalizeLiveLayoutMode('nope')).toBe(LIVE_LAYOUT_MODES.HOST_TOP_9);
    expect(DEFAULT_LIVE_LAYOUT_MODE).toBe(LIVE_LAYOUT_MODES.HOST_TOP_9);
    expect(layoutUsesBottomTray(LIVE_LAYOUT_MODES.BOTTOM_GRID)).toBe(true);
    expect(layoutUsesBottomTray(LIVE_LAYOUT_MODES.EQUAL_GRID)).toBe(false);
    expect(layoutUsesBottomTray(LIVE_LAYOUT_MODES.SOLO)).toBe(false);
    expect(layoutUsesBottomTray(LIVE_LAYOUT_MODES.HOST_TOP_9)).toBe(false);
    expect(guestBoxesForLayout(LIVE_LAYOUT_MODES.SOLO)).toBe(0);
    expect(guestBoxesForLayout(LIVE_LAYOUT_MODES.HOST_TOP_9)).toBe(9);
    expect(MAX_GUEST_SLOTS).toBe(11);
  });

  it('maps Studio host layouts onto phone compositional modes', () => {
    expect(mapStudioLayoutToLiveLayoutMode('side-by-side')).toBe(LIVE_LAYOUT_MODES.SIDE_BY_SIDE);
    expect(mapStudioLayoutToLiveLayoutMode('split-dual')).toBe(LIVE_LAYOUT_MODES.SIDE_BY_SIDE);
    expect(mapStudioLayoutToLiveLayoutMode('host-top')).toBe(LIVE_LAYOUT_MODES.HOST_FOCUS);
    expect(mapStudioLayoutToLiveLayoutMode('quad')).toBe(LIVE_LAYOUT_MODES.EQUAL_GRID);
    expect(mapStudioLayoutToLiveLayoutMode('grid-3x3')).toBe(LIVE_LAYOUT_MODES.EQUAL_GRID);
    expect(mapStudioLayoutToLiveLayoutMode('solo')).toBe(LIVE_LAYOUT_MODES.SOLO);
    expect(mapStudioLayoutToLiveLayoutMode('host-top-9')).toBe(LIVE_LAYOUT_MODES.HOST_TOP_9);
    expect(mapStudioLayoutToLiveLayoutMode('nope')).toBeNull();
  });

  it('treats an in-session Studio layout swap as the same Stage session (chrome only)', () => {
    const before = resolveLiveLayoutMode({
      studioLayout: 'solo',
      guestLayoutMode: 'bottom_grid',
    });
    const after = resolveLiveLayoutMode({
      studioLayout: 'host-top-9',
      guestLayoutMode: 'solo',
    });
    expect(before).toBe(LIVE_LAYOUT_MODES.SOLO);
    expect(after).toBe(LIVE_LAYOUT_MODES.HOST_TOP_9);
    expect(before).not.toBe(after);
  });

  it('defaults a missing phone layout to host-top-9 so it matches Studio portrait', () => {
    expect(normalizeLiveLayoutMode(undefined)).toBe(LIVE_LAYOUT_MODES.HOST_TOP_9);
    expect(resolveLiveLayoutMode({})).toBe(LIVE_LAYOUT_MODES.HOST_TOP_9);
    expect(mapStudioLayoutToLiveLayoutMode('host-top-9')).toBe(DEFAULT_LIVE_LAYOUT_MODE);
  });

  it('binds the featured tile to host camera/screen, never the program composite', () => {
    const composite = { participantId: 'program', isHost: true, isProgramComposite: true, slotIndex: 0 };
    const camera = { participantId: 'cam', isHost: true, slotIndex: 0 };
    const screen = { participantId: 'scr', isHost: true, isScreenShare: true, slotIndex: 0 };
    const guest = { participantId: 'g1', slotIndex: 1 };
    expect(pickHostWatchStream([composite, camera, guest])?.participantId).toBe('cam');
    expect(pickHostWatchStream([composite, screen, camera])?.participantId).toBe('scr');
    expect(pickHostWatchStream([guest, camera])?.participantId).toBe('cam');
    expect(pickHostWatchStream([composite])).toBeNull();
    expect(guestBoxesForLayout(LIVE_LAYOUT_MODES.HOST_TOP_9)).toBe(9);
  });

  it('fits host 16:9 + 3x3 + chat into the measured header/footer window', () => {
    const layout = measureHostTop9WatchLayout(360, 520);
    expect(layout.hostH + layout.gridH + layout.chatH).toBe(520);
    expect(layout.hostH).toBeLessThanOrEqual(Math.round(520 * 0.36));
    expect(layout.gridH).toBeGreaterThan(0);
    expect(layout.chatH).toBeGreaterThan(0);
    const expanded = measureHostTop9WatchLayout(360, 520, { expanded: true });
    expect(expanded.hostH).toBe(520);
    expect(expanded.gridH).toBe(0);
    expect(expanded.chatH).toBe(0);
    const noChat = measureHostTop9WatchLayout(360, 520, { hideChat: true });
    expect(noChat.chatH).toBe(0);
    expect(noChat.hostH + noChat.gridH).toBe(520);
    expect(guestBoxesForLayout(LIVE_LAYOUT_MODES.HOST_TOP_9)).toBe(9);
  });

  it('lets Studio layout win over a stale phone guestLayoutMode', () => {
    expect(
      resolveLiveLayoutMode({
        studioLayout: 'side-by-side',
        guestLayoutMode: 'bottom_grid',
      }),
    ).toBe(LIVE_LAYOUT_MODES.SIDE_BY_SIDE);
    expect(
      resolveLiveLayoutMode({
        studioLayout: 'solo',
        guestLayoutMode: 'bottom_grid',
      }),
    ).toBe(LIVE_LAYOUT_MODES.SOLO);
    expect(
      resolveLiveLayoutMode({
        studioLayout: 'host-top-9',
        guestLayoutMode: 'equal_grid',
      }),
    ).toBe(LIVE_LAYOUT_MODES.HOST_TOP_9);
    expect(
      resolveLiveLayoutMode({
        guestLayoutMode: 'equal_grid',
      }),
    ).toBe(LIVE_LAYOUT_MODES.EQUAL_GRID);
  });

  it('uses a 3-wide tray (collapsed 3 / expanded 6)', () => {
    expect(guestsPerTrayPage(LIVE_LAYOUT_MODES.BOTTOM_GRID, 'collapsed')).toBe(3);
    expect(guestsPerTrayPage(LIVE_LAYOUT_MODES.BOTTOM_GRID, 'expanded')).toBe(6);
    expect(guestsPerTrayPage(LIVE_LAYOUT_MODES.HOST_FOCUS, 'expanded')).toBe(3);
  });

  it('builds a fluid visible slot list that skips empty sticky holes', () => {
    expect(
      buildVisibleGuestSlotIds({
        occupiedSlots: [1, 3],
        reservedSlots: [5],
        joinSlotId: 2,
      })
    ).toEqual([1, 2, 3, 5]);
    expect(buildVisibleGuestSlotIds({ occupiedSlots: [], joinSlotId: 1 })).toEqual([1]);
  });

  it('sizes tiles larger for 1–2 guests and 3-wide beyond that', () => {
    expect(guestTileWidthPercent(1)).toBeGreaterThan(guestTileWidthPercent(3));
    expect(guestTileWidthPercent(2)).toBeGreaterThan(guestTileWidthPercent(3));
    expect(guestTileWidthPercent(4)).toBe(guestTileWidthPercent(3));
  });
});
