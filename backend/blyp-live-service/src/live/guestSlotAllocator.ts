/**
 * Sticky guest-box allocation for live multi-guest stages.
 *
 * Product rules:
 * - Host is NEVER a guest box (token slot 0 / separate full-bleed tile).
 * - Guest boxes are 1..MAX_GUEST_SLOTS only.
 * - First free sticky box wins; vacated mid-panel boxes stay empty (no compact).
 */

/** IVS Real-Time hard-caps a stage at 12 publishers; host + 11 guests. */
export const MAX_PUBLISHERS_PER_STAGE = 12;
export const MAX_GUEST_SLOTS = MAX_PUBLISHERS_PER_STAGE - 1; // 11
export const MIN_GUEST_SLOT = 1;

export type GuestSlotOccupant = {
  userId?: string;
  state?: string;
  slotIndex?: number;
};

export function pickSlotIndex(used: Set<number>, preferred?: number): number {
  const MIN = MIN_GUEST_SLOT;
  const MAX = MAX_GUEST_SLOTS;
  if (typeof preferred === 'number' && preferred >= MIN && preferred <= MAX && !used.has(preferred)) {
    return preferred;
  }
  for (let i = MIN; i <= MAX; i++) {
    if (!used.has(i)) return i;
  }
  // Fallback (should never happen — callers guard against a full panel first).
  return MIN;
}

/**
 * Build the set of guest boxes currently held by INVITED or live (non-stale) guests.
 * Host uid and non-guest indices (0 / out of range) are ignored.
 */
export function collectUsedGuestSlots(
  guests: GuestSlotOccupant[],
  opts: {
    hostUserId?: string;
    isStale: (g: GuestSlotOccupant) => boolean;
  }
): Set<number> {
  const used = new Set<number>();
  for (const g of guests) {
    if (!g) continue;
    if (opts.hostUserId && g.userId && g.userId === opts.hostUserId) continue;
    const active =
      (g.state === 'INVITED' && !opts.isStale(g)) ||
      (g.state === 'LIVE' && !opts.isStale(g));
    if (
      active &&
      typeof g.slotIndex === 'number' &&
      g.slotIndex >= MIN_GUEST_SLOT &&
      g.slotIndex <= MAX_GUEST_SLOTS
    ) {
      used.add(g.slotIndex);
    }
  }
  return used;
}
