/**
 * Frenemies seat / queue rules (server-authoritative).
 *
 * Round settle = finishResolving after a round's result banner ends
 * (throw / timeout / challenge timeout / solo win — outcome is done).
 *
 * Rules:
 * 1) Auto-drop + auto-fill at round settle: drop one eligible seated guest
 *    (unless a kick already happened this round), then promote FIFO queue.
 * 2) Join requests enqueue FIFO (comment / guest CTA).
 * 3) Just-dropped cooldown: cannot reseat until a later roundIndex
 *    (sit out ≥ one full round).
 * 4) First-spin protection: cannot be auto-dropped or thrown until they have
 *    survived a wheel land while seated (hasHadWheelHit). Cleared for every
 *    on-stage guest when the spin lands — not only the landed box — otherwise
 *    throw targets stay empty forever (chooser cannot target self).
 */
import { logger } from '../../config/logger';
import { emitRoomEvent } from '../../realtime/realtimeBus';
import { MAX_GUEST_SLOTS } from '../../live/guestSlotAllocator';

export interface SeatMeta {
  userId: string;
  displayName: string;
  /** True after surviving ≥1 wheel land while seated this stint. */
  hasHadWheelHit: boolean;
  /** roundIndex when they were first seated this stint. */
  seatedAtRoundIndex: number;
  /** roundIndex when last dropped/kicked; null if never. */
  justDroppedRoundId: number | null;
}

export type SeatOccupantRef = { userId: string; displayName: string; slotIndex: number };

export interface QueueEntry {
  userId: string;
  displayName: string;
  photoUrl?: string | null;
  requestedAt: string;
  source: 'comment' | 'guest_request' | 'cta';
}

export type SeatRoster = Record<string, SeatMeta>;

export function emptySeatRoster(): SeatRoster {
  return {};
}

export function ensureSeatMeta(
  roster: SeatRoster,
  userId: string,
  displayName: string,
  roundIndex: number,
): SeatMeta {
  const prev = roster[userId];
  if (prev) {
    if (displayName && prev.displayName !== displayName) {
      prev.displayName = displayName;
    }
    return prev;
  }
  const meta: SeatMeta = {
    userId,
    displayName: displayName || 'Guest',
    hasHadWheelHit: false,
    seatedAtRoundIndex: Math.max(0, roundIndex | 0),
    justDroppedRoundId: null,
  };
  roster[userId] = meta;
  return meta;
}

/** Clear first-spin protection for one seated guest. */
export function markWheelHit(roster: SeatRoster, userId: string | null | undefined): void {
  if (!userId) return;
  const m = roster[userId];
  if (m) m.hasHadWheelHit = true;
}

/** Clear first-spin for everyone who was on stage when the wheel landed. */
export function markSurvivedWheelLand(roster: SeatRoster, userIds: Iterable<string>): void {
  for (const userId of userIds) {
    markWheelHit(roster, userId);
  }
}

export function isDropProtected(roster: SeatRoster, userId: string): boolean {
  const m = roster[userId];
  // Unknown / first join → protected until they survive a wheel land.
  if (!m) return true;
  return m.hasHadWheelHit !== true;
}

/**
 * Guests the chooser may throw: on-stage, not self, not host, not first-spin protected.
 */
export function listThrowableOccupants(
  occupants: SeatOccupantRef[],
  roster: SeatRoster,
  opts: { chooserUserId: string; hostUserId?: string | null },
): SeatOccupantRef[] {
  const chooser = opts.chooserUserId;
  const host = opts.hostUserId || null;
  return (occupants || []).filter((o) => {
    if (!o?.userId) return false;
    if (o.userId === chooser) return false;
    if (host && o.userId === host) return false;
    return !isDropProtected(roster, o.userId);
  });
}

/** Eligible to rejoin queue→seat after sitting out ≥ one full round. */
export function isCooldownClear(
  meta: SeatMeta | undefined,
  currentRoundIndex: number,
): boolean {
  if (!meta || meta.justDroppedRoundId == null) return true;
  return currentRoundIndex > meta.justDroppedRoundId;
}

export function recordDrop(
  roster: SeatRoster,
  userId: string,
  displayName: string,
  roundIndex: number,
): void {
  const m = ensureSeatMeta(roster, userId, displayName, roundIndex);
  m.justDroppedRoundId = Math.max(0, roundIndex | 0);
  // Next seat stint starts fresh for first-spin protection.
  m.hasHadWheelHit = false;
  m.seatedAtRoundIndex = roundIndex;
}

export function enqueueJoin(
  queue: QueueEntry[],
  entry: QueueEntry,
): { queue: QueueEntry[]; enqueued: boolean; reason?: string } {
  if (!entry.userId) return { queue, enqueued: false, reason: 'NO_USER' };
  if (queue.some((q) => q.userId === entry.userId)) {
    return { queue, enqueued: false, reason: 'ALREADY_QUEUED' };
  }
  return {
    queue: [...queue, entry],
    enqueued: true,
  };
}

export function dequeueUser(queue: QueueEntry[], userId: string): QueueEntry[] {
  return queue.filter((q) => q.userId !== userId);
}

/**
 * Fair auto-drop target: longest-seated among guests who already had a wheel hit.
 * Never picks first-spin-protected players.
 */
export function pickAutoDropTarget(
  occupants: SeatOccupantRef[],
  roster: SeatRoster,
  excludeUserIds: Set<string> = new Set(),
): SeatOccupantRef | null {
  const eligible = occupants.filter((o) => {
    if (!o.userId || excludeUserIds.has(o.userId)) return false;
    return !isDropProtected(roster, o.userId);
  });
  if (!eligible.length) return null;
  eligible.sort((a, b) => {
    const ra = roster[a.userId]?.seatedAtRoundIndex ?? 0;
    const rb = roster[b.userId]?.seatedAtRoundIndex ?? 0;
    if (ra !== rb) return ra - rb;
    return a.slotIndex - b.slotIndex;
  });
  return eligible[0];
}

export function publicSeatSnapshot(roster: SeatRoster, queue: QueueEntry[]) {
  return {
    seatMeta: Object.fromEntries(
      Object.entries(roster || {}).map(([uid, m]) => [
        uid,
        {
          userId: m.userId,
          displayName: m.displayName,
          hasHadWheelHit: !!m.hasHadWheelHit,
          seatedAtRoundIndex: m.seatedAtRoundIndex,
          justDroppedRoundId: m.justDroppedRoundId,
          protected: m.hasHadWheelHit !== true,
          cooldownUntilRound: m.justDroppedRoundId == null ? null : m.justDroppedRoundId + 1,
        },
      ]),
    ),
    queue: (queue || []).map((q, i) => ({
      ...q,
      position: i + 1,
    })),
  };
}

async function forceKickQuiet(sessionId: string, guestUserId: string): Promise<void> {
  const { leaveGuestSession } = await import('../../live/guestSlotStore');
  try {
    await leaveGuestSession(sessionId, guestUserId, new Date().toISOString(), { force: true });
    emitRoomEvent(sessionId, { type: 'guest.kicked', guestUserId, reason: 'frenemies_auto_drop' });
  } catch (e: any) {
    logger.warn({ sessionId, guestUserId, err: e?.message }, '[frenemies] auto-drop kick failed');
  }
}

/**
 * After round outcome is done: optional auto-drop + FIFO auto-fill.
 * `alreadyDroppedUserId` — kick from throw/timeout this round (counts as the drop).
 */
export async function settleSeatsAfterRound(args: {
  sessionId: string;
  hostUserId: string;
  roundIndex: number;
  roster: SeatRoster;
  queue: QueueEntry[];
  occupants: { userId: string; displayName: string; slotIndex: number }[];
  alreadyDroppedUserId?: string | null;
}): Promise<{
  roster: SeatRoster;
  queue: QueueEntry[];
  droppedUserId: string | null;
  seatedUserIds: string[];
}> {
  const { inviteGuest, requestGuestSlot } = await import('../../live/liveService');
  const roster = { ...args.roster };
  let queue = [...(args.queue || [])];
  const roundIndex = Math.max(0, args.roundIndex | 0);
  let droppedUserId: string | null = args.alreadyDroppedUserId || null;
  const seatedUserIds: string[] = [];

  for (const o of args.occupants) {
    ensureSeatMeta(roster, o.userId, o.displayName, roundIndex);
  }

  if (droppedUserId) {
    const name =
      args.occupants.find((o) => o.userId === droppedUserId)?.displayName ||
      roster[droppedUserId]?.displayName ||
      'Guest';
    recordDrop(roster, droppedUserId, name, roundIndex);
    queue = dequeueUser(queue, droppedUserId);
  } else {
    const target = pickAutoDropTarget(args.occupants, roster);
    if (target) {
      await forceKickQuiet(args.sessionId, target.userId);
      recordDrop(roster, target.userId, target.displayName, roundIndex);
      queue = dequeueUser(queue, target.userId);
      droppedUserId = target.userId;
    }
  }

  const occupiedIds = new Set(
    args.occupants
      .filter((o) => o.userId !== droppedUserId)
      .map((o) => o.userId),
  );
  let openSlots = Math.max(0, MAX_GUEST_SLOTS - occupiedIds.size);

  while (openSlots > 0) {
    const idx = queue.findIndex(
      (q) => !occupiedIds.has(q.userId) && isCooldownClear(roster[q.userId], roundIndex),
    );
    if (idx < 0) break;
    const next = queue[idx];
    queue = queue.filter((q) => q.userId !== next.userId);
    const meta = roster[next.userId];

    try {
      await requestGuestSlot(args.sessionId, next.userId);
    } catch (e: any) {
      if (e?.code !== 'GUEST_SESSION_ACTIVE') {
        logger.warn(
          { sessionId: args.sessionId, userId: next.userId, err: e?.message },
          '[frenemies] queue requestGuestSlot failed',
        );
      }
    }
    try {
      await inviteGuest(args.sessionId, next.userId, args.hostUserId);
      ensureSeatMeta(roster, next.userId, next.displayName, roundIndex);
      roster[next.userId].hasHadWheelHit = false;
      roster[next.userId].seatedAtRoundIndex = roundIndex;
      roster[next.userId].justDroppedRoundId = meta?.justDroppedRoundId ?? null;
      occupiedIds.add(next.userId);
      seatedUserIds.push(next.userId);
      openSlots -= 1;
      emitRoomEvent(args.sessionId, {
        type: 'frenemies.queue.promoted',
        guestUserId: next.userId,
      });
    } catch (e: any) {
      logger.warn(
        { sessionId: args.sessionId, userId: next.userId, err: e?.message, code: e?.code },
        '[frenemies] queue auto-invite failed',
      );
      if (e?.code === 'PANEL_FULL' || /full/i.test(String(e?.message || ''))) {
        queue = [next, ...queue];
        break;
      }
    }
  }

  return { roster, queue, droppedUserId, seatedUserIds };
}
