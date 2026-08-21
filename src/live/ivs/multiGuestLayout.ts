/**
 * Multi-guest live layout modes + sticky slot helpers.
 *
 * Product rules:
 * - Guests occupy fixed 1-based slot indices (box 1..MAX_GUEST_SLOTS) for media binding.
 * - Host + all viewers must agree on placement (token attr + mirrored roster).
 * - Bottom tray chrome shows a fluid visible set (occupied + joining + one join/invite CTA)
 *   that reflows 1→2→3-wide with smooth layout animation — empty sticky holes are not painted.
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
  /** Studio Solo, portrait: host fills the 9:16 phone. */
  SOLO: 'solo',
  /** Studio Host + 9: 16:9 host band on top, 3×3 guest boxes under. */
  HOST_TOP_9: 'host_top_9',
} as const;

export type LiveLayoutMode = (typeof LIVE_LAYOUT_MODES)[keyof typeof LIVE_LAYOUT_MODES];

/** Phone watch default (portrait live). Matches Studio `host-top-9`. */
export const DEFAULT_LIVE_LAYOUT_MODE: LiveLayoutMode = LIVE_LAYOUT_MODES.HOST_TOP_9;

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
    value === LIVE_LAYOUT_MODES.BOTTOM_GRID ||
    value === LIVE_LAYOUT_MODES.SOLO ||
    value === LIVE_LAYOUT_MODES.HOST_TOP_9
  ) {
    return value;
  }
  return DEFAULT_LIVE_LAYOUT_MODE;
}

/**
 * Studio program layouts (`apps/blyp-world/lib/studioStageLayouts.ts`).
 * Keep ids in sync with STAGE_LAYOUTS. Phone default is HOST_TOP_9 (Studio host-top-9).
 * Other Studio presets map onto the closest phone compositional mode.
 */
const STUDIO_LAYOUT_TO_LIVE: Record<string, LiveLayoutMode> = {
  solo: LIVE_LAYOUT_MODES.SOLO,
  'host-top': LIVE_LAYOUT_MODES.HOST_FOCUS,
  'host-top-9': LIVE_LAYOUT_MODES.HOST_TOP_9,
  'split-stack': LIVE_LAYOUT_MODES.EQUAL_GRID,
  'host-bottom': LIVE_LAYOUT_MODES.HOST_FOCUS,
  'host-bottom-9': LIVE_LAYOUT_MODES.EQUAL_GRID,
  'side-by-side': LIVE_LAYOUT_MODES.SIDE_BY_SIDE,
  'focus-rail': LIVE_LAYOUT_MODES.HOST_FOCUS,
  'tri-stack': LIVE_LAYOUT_MODES.EQUAL_GRID,
  quad: LIVE_LAYOUT_MODES.EQUAL_GRID,
  'cinema-bar': LIVE_LAYOUT_MODES.HOST_FOCUS,
  'split-dual': LIVE_LAYOUT_MODES.SIDE_BY_SIDE,
  'host-left-rail': LIVE_LAYOUT_MODES.SIDE_BY_SIDE,
  'focus-plus-4': LIVE_LAYOUT_MODES.HOST_FOCUS,
  'grid-3x3': LIVE_LAYOUT_MODES.EQUAL_GRID,
};

export function mapStudioLayoutToLiveLayoutMode(raw: unknown): LiveLayoutMode | null {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return null;
  return STUDIO_LAYOUT_TO_LIVE[id] || null;
}

/** Studio host layout wins over a phone host's guestLayoutMode when both exist. */
export function resolveLiveLayoutMode(input: {
  studioLayout?: unknown;
  guestLayoutMode?: unknown;
}): LiveLayoutMode {
  return (
    mapStudioLayoutToLiveLayoutMode(input.studioLayout) ||
    normalizeLiveLayoutMode(input.guestLayoutMode)
  );
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

/** Guest boxes this Studio layout paints (not the IVS publisher cap). */
export function guestBoxesForLayout(mode: LiveLayoutMode): number {
  if (mode === LIVE_LAYOUT_MODES.SOLO) return 0;
  if (mode === LIVE_LAYOUT_MODES.HOST_TOP_9) return 9;
  return MAX_GUEST_SLOTS;
}

export const HOST_TOP_9_PINK = '#FF2D55';

export type HostTop9WatchLayout = {
  hostH: number;
  gridH: number;
  chatH: number;
};

/**
 * Fit Host+9 inside the content window BETWEEN header chrome and footer bar.
 * Host stays a 16:9 band (~top third); chat/gift sit under the 3×3, not over it.
 */
export function measureHostTop9WatchLayout(
  contentW: number,
  contentH: number,
  opts?: { expanded?: boolean }
): HostTop9WatchLayout {
  const w = Math.max(1, Math.floor(contentW || 0));
  const h = Math.max(1, Math.floor(contentH || 0));
  if (opts?.expanded) {
    return { hostH: h, gridH: 0, chatH: 0 };
  }
  const chatH = Math.min(120, Math.max(72, Math.round(h * 0.17)));
  const idealHost = Math.round(w * (9 / 16));
  const maxHost = Math.round(h * 0.36);
  const minHost = Math.min(maxHost, Math.round(h * 0.22));
  const hostH = Math.min(maxHost, Math.max(minHost, idealHost));
  const gridH = Math.max(84, h - hostH - chatH);
  return { hostH, gridH, chatH };
}

/**
 * Guests per tray page for bottom/focus modes.
 * Collapsed = one row of 3; expanded = two rows of 3.
 */
export function guestsPerTrayPage(mode: LiveLayoutMode, trayDensity: 'collapsed' | 'expanded'): number {
  if (mode === LIVE_LAYOUT_MODES.HOST_FOCUS) return 3;
  return trayDensity === 'expanded' ? 6 : 3;
}

/**
 * Visible tray tiles: occupied / reserved sticky slots plus optional join CTA.
 * Empty sticky holes are omitted so the row can reflow fluidly as guests join/leave.
 */
export function buildVisibleGuestSlotIds(opts: {
  totalSlots?: number;
  occupiedSlots: Iterable<number>;
  reservedSlots?: Iterable<number>;
  joinSlotId?: number | null;
}): number[] {
  const total = opts.totalSlots ?? MAX_GUEST_SLOTS;
  const occupied = opts.occupiedSlots instanceof Set ? opts.occupiedSlots : new Set(opts.occupiedSlots);
  const reserved =
    opts.reservedSlots instanceof Set
      ? opts.reservedSlots
      : new Set(opts.reservedSlots || []);
  const out: number[] = [];
  for (let slotId = 1; slotId <= total; slotId += 1) {
    if (occupied.has(slotId) || reserved.has(slotId) || opts.joinSlotId === slotId) {
      out.push(slotId);
    }
  }
  return out;
}

/**
 * Fluid tile width (%) for a page with `visibleCount` tiles (max 3 columns).
 * 1 → large hero tile; 2 → twin stage; 3+ → true 3-wide grid.
 */
export function guestTileWidthPercent(visibleCount: number): number {
  const n = Math.max(1, Math.floor(visibleCount || 1));
  if (n <= 1) return 54;
  if (n === 2) return 43;
  return 31;
}

export function guestTileHorizontalMarginPercent(visibleCount: number): number {
  const n = Math.max(1, Math.floor(visibleCount || 1));
  if (n <= 1) return 2;
  if (n === 2) return 1.75;
  return 1.1;
}

