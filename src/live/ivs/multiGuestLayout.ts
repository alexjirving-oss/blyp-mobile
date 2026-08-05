/**
 * Multi-guest live layout modes + sticky slot helpers.
 *
 * Product rules:
 * - Guests occupy fixed 1-based slot indices (box 1..MAX_GUEST_SLOTS).
 * - Leaving a slot leaves an empty placeholder; remaining guests do NOT compact.
 * - Host + all viewers must agree on placement (token attr + mirrored roster).
 */

/** Must stay in sync with MAX_GUEST_SLOTS in ivsLiveApi / liveService. */
export const MAX_GUEST_SLOTS = 11;

/** Host + up to 11 guests (IVS Real-Time publisher hard cap). */
export const MAX_STAGE_PUBLISHERS = MAX_GUEST_SLOTS + 1;

export const LIVE_LAYOUT_MODES = {
  BOTTOM_GRID: 'bottom_grid',
  HOST_FOCUS: 'host_focus',
  EQUAL_GRID: 'equal_grid',
  SIDE_BY_SIDE: 'side_by_side',
} as const;

export type LiveLayoutMode = (typeof LIVE_LAYOUT_MODES)[keyof typeof LIVE_LAYOUT_MODES];

export type LiveLayoutOption = {
  id: LiveLayoutMode;
  label: string;
  icon: string;
  hint: string;
};

/** Host-selectable compositional layouts (sticky slots apply inside each). */
export const LIVE_LAYOUT_OPTIONS: LiveLayoutOption[] = [
  {
    id: LIVE_LAYOUT_MODES.BOTTOM_GRID,
    label: 'Bottom',
    icon: 'grid-outline',
    hint: 'Host full-screen, guests in bottom grid',
  },
  {
    id: LIVE_LAYOUT_MODES.HOST_FOCUS,
    label: 'Focus',
    icon: 'tablet-portrait-outline',
    hint: 'Host large with guest strip',
  },
  {
    id: LIVE_LAYOUT_MODES.EQUAL_GRID,
    label: 'Equal',
    icon: 'apps-outline',
    hint: 'Equal tiles for host and guests',
  },
  {
    id: LIVE_LAYOUT_MODES.SIDE_BY_SIDE,
    label: 'Split',
    icon: 'tablet-landscape-outline',
    hint: 'Host beside sticky guest column',
  },
];

export function normalizeLiveLayoutMode(raw: unknown): LiveLayoutMode {
  const value = typeof raw === 'string' ? raw : '';
  if (
    value === LIVE_LAYOUT_MODES.HOST_FOCUS ||
    value === LIVE_LAYOUT_MODES.EQUAL_GRID ||
    value === LIVE_LAYOUT_MODES.SIDE_BY_SIDE ||
    value === LIVE_LAYOUT_MODES.BOTTOM_GRID
  ) {
    return value;
  }
  return LIVE_LAYOUT_MODES.BOTTOM_GRID;
}

export type StickySlotEntry<T> = {
  slotId: number;
  occupant: T | null;
};

/**
 * Build a dense 1..N slot array with empty placeholders for vacant boxes.
 * Never compacts remaining occupants into lower indices.
 */
export function buildStickyGuestSlots<T>(
  guestBySlot: Map<number, T> | Record<number, T>,
  totalSlots: number = MAX_GUEST_SLOTS
): StickySlotEntry<T>[] {
  const map =
    guestBySlot instanceof Map
      ? guestBySlot
      : new Map(
          Object.entries(guestBySlot || {}).map(([k, v]) => [Number(k), v] as [number, T])
        );
  const out: StickySlotEntry<T>[] = [];
  for (let slotId = 1; slotId <= totalSlots; slotId += 1) {
    out.push({ slotId, occupant: map.get(slotId) ?? null });
  }
  return out;
}

/** First vacant sticky slot (1-based), or null when full. */
export function firstEmptyStickySlot(
  occupied: Iterable<number>,
  totalSlots: number = MAX_GUEST_SLOTS
): number | null {
  const used = occupied instanceof Set ? occupied : new Set(occupied);
  for (let i = 1; i <= totalSlots; i += 1) {
    if (!used.has(i)) return i;
  }
  return null;
}

/** Whether this layout uses the bottom guest tray chrome (pager + swipe). */
export function layoutUsesBottomTray(mode: LiveLayoutMode): boolean {
  return mode === LIVE_LAYOUT_MODES.BOTTOM_GRID || mode === LIVE_LAYOUT_MODES.HOST_FOCUS;
}

/** Guests per tray page for bottom/focus modes. */
export function guestsPerTrayPage(mode: LiveLayoutMode, trayDensity: 'collapsed' | 'expanded'): number {
  if (mode === LIVE_LAYOUT_MODES.HOST_FOCUS) return 4;
  return trayDensity === 'expanded' ? 8 : 4;
}
