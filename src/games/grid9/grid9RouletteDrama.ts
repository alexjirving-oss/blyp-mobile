/**
 * Grid 9 roulette highlight cadence — discrete ticks, not RAF flicker.
 *
 * Start ~2 Hz (500ms), ease to ~1 Hz (1000ms), then hold the winning seat
 * ~1.5s before land/stop. Total spin stays at GRID9_ROULETTE_DURATION_MS (~12s).
 */
export const GRID9_ROULETTE_TICK_START_MS = 500;
export const GRID9_ROULETTE_TICK_LATE_MS = 1000;
export const GRID9_ROULETTE_LAND_HOLD_MS = 1500;

export type Grid9RouletteTick = {
  atMs: number;
  candidateOffset: number;
  landed: boolean;
};

export function buildGrid9RouletteTicks(args: {
  durationMs: number;
  candidateCount: number;
  selectedOffset: number;
}): Grid9RouletteTick[] {
  const n = Math.max(1, Math.floor(args.candidateCount));
  const selected = ((Math.floor(args.selectedOffset) % n) + n) % n;
  const duration = Math.max(10_000, Math.floor(args.durationMs) || 12_000);
  const holdMs = GRID9_ROULETTE_LAND_HOLD_MS;
  const spinMs = Math.max(holdMs, duration - holdMs);

  const times: number[] = [0];
  let t = 0;
  while (t < spinMs) {
    const p = Math.min(1, t / spinMs);
    const interval =
      GRID9_ROULETTE_TICK_START_MS +
      p * (GRID9_ROULETTE_TICK_LATE_MS - GRID9_ROULETTE_TICK_START_MS);
    t += interval;
    if (t >= spinMs) break;
    times.push(t);
  }

  const ticks: Grid9RouletteTick[] = times.map((atMs, index) => {
    const stepsFromEnd = times.length - 1 - index;
    const offset = ((selected - stepsFromEnd) % n + n) % n;
    return { atMs, candidateOffset: offset, landed: false };
  });

  const last = ticks[ticks.length - 1];
  if (!last || last.atMs < spinMs - 8) {
    ticks.push({ atMs: spinMs, candidateOffset: selected, landed: true });
  } else {
    last.candidateOffset = selected;
    last.landed = true;
    last.atMs = spinMs;
  }
  return ticks;
}

export function grid9RouletteTickAtElapsed(
  elapsedMs: number,
  ticks: Grid9RouletteTick[],
): Grid9RouletteTick {
  if (ticks.length === 0) {
    return { atMs: 0, candidateOffset: 0, landed: true };
  }
  let current = ticks[0];
  for (const tick of ticks) {
    if (tick.atMs <= elapsedMs) current = tick;
    else break;
  }
  return current;
}

/** @deprecated Prefer buildGrid9RouletteTicks — kept for older call sites. */
export function dramaticRouletteHighlightIndex(
  progress01: number,
  candidateCount: number,
  selectedOffset: number,
): number {
  const n = Math.max(1, candidateCount);
  const ticks = buildGrid9RouletteTicks({
    durationMs: 12_000,
    candidateCount: n,
    selectedOffset,
  });
  const elapsed = Math.max(0, Math.min(1, progress01)) * 12_000;
  return grid9RouletteTickAtElapsed(elapsed, ticks).candidateOffset;
}
